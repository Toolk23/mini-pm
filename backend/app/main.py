"""«мини ПМ» — API. Контракт: docs/api.md (раздел 4 плана)."""
from __future__ import annotations

import shutil
import threading
import uuid

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, detector, ingest, llm, mailer, metrika, settings_store, store, websearch

app = FastAPI(title="мини ПМ", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _search_index():
    from .rag import get_index  # модуль поиска грузится лениво
    return get_index(config.DATA_DIR)


# ------------------------------------------------------------------ служебное
@app.get("/api/health")
def health():
    return {"ok": True, "data": ingest.warmup(), "llm": {"configured": llm.available(), "provider": config.LLM_PROVIDER,
                                                          "model": config.LLM_MODEL,
                                                          "models_by_step": {s: config.model_for(s) for s in ("investigation", "chat")}},
            "metrika": {"configured": metrika.configured()}, "web_search": {"configured": websearch.configured()},
            "mail": {"configured": mailer.configured(), "to": config.MAIL_TO if mailer.configured() else None}}


# ------------------------------------------------------------------ метрики и данные
@app.get("/api/metrics")
def metrics():
    st = settings_store.load()["metrics"]
    cat = ingest.metrics_catalog().fillna("")
    return [{**r, "rule": st.get(r["metric_id"])} for r in cat.to_dict("records")]


@app.get("/api/metrics/{metric_id}/series")
def metric_series(metric_id: str, product: str | None = None):
    if metric_id == "family_orders_idx":
        fam = {"Конфигуратор Kaspersky": "KES", "Конфигуратор Астра": "Astra"}.get(product or "", product or "KES")
        ser = detector.sales_series(fam)
        points = ser["points"]
    else:
        w = detector.weekly_metric(metric_id, product)
        points = [{"week_start": d.strftime("%Y-%m-%d"), "value": None if pd.isna(v) else round(float(v), 2),
                   "n": None if pd.isna(n) else int(n)} for d, v, n in zip(w.week, w.value, w.n)]
    rel = ingest.releases()
    annotations = [{"type": "release", "id": r.release_id, "date": r.release_date.strftime("%Y-%m-%d"),
                    "label": f"{r.release_id} ({r.release_type})", "description": r.description,
                    "affects_metric": metric_id in r.affected_metrics} for r in rel.itertuples()]
    gaps = detector.gaps_for(metric_id, product)
    return {"metric_id": metric_id, "product": product, "points": points, "annotations": annotations, "gaps": gaps}


@app.get("/api/sales")
def sales():
    return {f: detector.sales_series(f)["points"] for f in ("KES", "Astra")}


@app.get("/api/releases")
def releases():
    rel = ingest.releases()
    return [{**r, "release_date": r["release_date"].strftime("%Y-%m-%d")} for r in rel.to_dict("records")]


@app.get("/api/data-gaps")
def data_gaps():
    return ingest.DATA_GAPS


@app.get("/api/reference-case")
def reference_case():
    return ingest.reference_case()


# ------------------------------------------------------------------ сигналы
@app.get("/api/signals")
def signals():
    return detector.detect_all()


# ------------------------------------------------------------------ расследования
_JOBS: dict[str, dict] = {}


class InvestigationIn(BaseModel):
    signal_id: str


@app.post("/api/investigations")
def start_investigation(body: InvestigationIn):
    from . import investigator
    sig = next((s for s in detector.detect_all() if s["id"] == body.signal_id), None)
    if not sig:
        raise HTTPException(404, f"Сигнал {body.signal_id} не найден (возможно, изменились пороги)")
    inv_id = "INV-" + uuid.uuid4().hex[:6].upper()
    _JOBS[inv_id] = {"id": inv_id, "status": "running", "signal_id": sig["id"], "created_at": store.now()}

    def run():
        try:
            report = investigator.investigate(sig, inv_id)
            _JOBS[inv_id].update(status="done", report=report)
            saved = store.read("investigations", {})
            saved[inv_id] = _JOBS[inv_id]
            store.write("investigations", saved)
        except Exception as e:  # noqa: BLE001 — показываем ошибку в UI
            _JOBS[inv_id].update(status="error", error=str(e))

    threading.Thread(target=run, daemon=True).start()
    return _JOBS[inv_id]


@app.get("/api/investigations")
def list_investigations():
    saved = store.read("investigations", {})
    saved.update(_JOBS)
    return sorted(({k: v for k, v in j.items() if k != "report"} for j in saved.values()),
                  key=lambda j: j["created_at"], reverse=True)


@app.get("/api/investigations/{inv_id}")
def get_investigation(inv_id: str):
    job = _JOBS.get(inv_id) or store.read("investigations", {}).get(inv_id)
    if not job:
        raise HTTPException(404)
    return job


@app.post("/api/investigations/{inv_id}/apply")
def apply_investigation(inv_id: str):
    """«Курьер»: задача в бэклог с тегом, повышение приоритетов, гипотеза с критерием, письмо ПМу."""
    from . import courier
    job = _JOBS.get(inv_id) or store.read("investigations", {}).get(inv_id)
    if not job or job.get("status") != "done":
        raise HTTPException(409, "Расследование ещё не готово")
    if job.get("applied"):
        return job["applied"]
    applied = courier.apply(job["report"])
    job["applied"] = applied
    saved = store.read("investigations", {})
    saved[inv_id] = job
    store.write("investigations", saved)
    return applied


@app.post("/api/investigations/{inv_id}/send-email")
def resend_email(inv_id: str):
    """Повторная отправка письма ПМу (если при «Применить» SMTP не был настроен или почта не ответила)."""
    job = _JOBS.get(inv_id) or store.read("investigations", {}).get(inv_id)
    if not job or not job.get("applied"):
        raise HTTPException(409, "Сначала примените расследование")
    em = job["applied"]["email"]
    em["sent"] = mailer.send(em["subject"], em["body"])
    saved = store.read("investigations", {})
    saved[inv_id] = job
    store.write("investigations", saved)
    return em["sent"]


@app.get("/api/mail/log")
def mail_log():
    return store.read("mail_log", [])


# ------------------------------------------------------------------ бэклог
class TaskIn(BaseModel):
    title: str
    description: str
    priority: str = "High"
    linked_metric_ids: list[str] = []
    investigation_id: str | None = None


class TaskPatch(BaseModel):
    status: str | None = None
    priority: str | None = None


@app.get("/api/backlog/tasks")
def tasks():
    return store.backlog()


@app.post("/api/backlog/tasks")
def create_task(body: TaskIn):
    return store.create_task(body.title, body.description, body.priority, body.linked_metric_ids,
                             investigation_id=body.investigation_id)


@app.patch("/api/backlog/tasks/{task_id}")
def patch_task(task_id: str, body: TaskPatch):
    try:
        return store.update_task(task_id, **body.model_dump())
    except KeyError:
        raise HTTPException(404) from None


@app.get("/api/backlog/redmine.csv")
def backlog_redmine_csv(ai_only: bool = False):
    """CSV для импорта в Redmine; ai_only=true — только задачи с тегом «сгенерирована ИИ-помощником»."""
    from fastapi.responses import Response
    ts = [t for t in store.backlog() if not ai_only or config.AI_TAG in t.get("tags", [])]
    return Response("\ufeff" + store.redmine_csv(ts), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=redmine_import.csv"})


@app.get("/api/backlog/tasks/{task_id}/redmine")
def task_redmine(task_id: str):
    t = next((t for t in store.backlog() if t["task_id"] == task_id), None)
    if not t:
        raise HTTPException(404)
    return store.redmine_export(t)


# ------------------------------------------------------------------ гипотезы
class HypothesisIn(BaseModel):
    investigation_id: str | None = None
    text: str
    metric_id: str = "family_orders_idx"
    family: str = "KES"
    control_family: str = "Astra"
    target: str = "скользящий индекс за 4 недели вернулся к уровню базы"
    success_threshold_pct: float = -10  # «вернулся»: отклонение от базы не хуже −10%
    task_id: str | None = None


class MeasureIn(BaseModel):
    scenario: str = "recovered"  # recovered | not_recovered — синтетические «после-релизные» данные


@app.get("/api/hypotheses")
def hypotheses():
    return store.read("hypotheses", [])


@app.post("/api/hypotheses")
def create_hypothesis(body: HypothesisIn):
    hs = store.read("hypotheses", [])
    h = {"id": f"H-{len(hs) + 1:02d}", "status": "open", "created_at": store.now(), **body.model_dump()}
    hs.append(h)
    store.write("hypotheses", hs)
    return h


@app.post("/api/hypotheses/{hid}/measure")
def measure(hid: str, body: MeasureIn):
    from . import effect
    hs = store.read("hypotheses", [])
    h = next((x for x in hs if x["id"] == hid), None)
    if not h:
        raise HTTPException(404)
    result = effect.measure(h, body.scenario)
    h.update(status=result["verdict"], measurement=result)
    store.write("hypotheses", hs)
    if h.get("task_id"):
        store.update_task(h["task_id"], by="ai", status="Done" if result["verdict"] == "confirmed" else "Reopened")
    return result


# ------------------------------------------------------------------ настройки
@app.get("/api/settings")
def get_settings():
    return settings_store.load()


@app.put("/api/settings")
def put_settings(patch: dict):
    return settings_store.save(patch)


@app.put("/api/settings/metrics/{metric_id}")
def put_metric_setting(metric_id: str, patch: dict):
    return settings_store.save({"metrics": {metric_id: patch}})["metrics"][metric_id]


@app.post("/api/settings/reset")
def reset_settings():
    return settings_store.reset()


# ------------------------------------------------------------------ знания (закрытый контур)
@app.get("/api/knowledge/search")
def knowledge_search(q: str, k: int = 8, source: str | None = None):
    return _search_index().search(q, k=k, source_types=[source] if source else None)


@app.post("/api/knowledge/upload")
def knowledge_upload(file: UploadFile = File(...)):
    dest = config.DATA_DIR / "uploads" / file.filename.replace("/", "_")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return _search_index().add_file(dest)


@app.post("/api/knowledge/reindex")
def knowledge_reindex():
    return _search_index().build()


# ------------------------------------------------------------------ чат
class ChatIn(BaseModel):
    message: str
    history: list[dict] = []


@app.post("/api/chat")
def chat(body: ChatIn):
    from . import investigator
    return investigator.answer(body.message, body.history)


# ------------------------------------------------------------------ справка для отдела продаж
class SalesBriefIn(BaseModel):
    product: str = "KES"


@app.post("/api/sales-briefs")
def create_sales_brief(body: SalesBriefIn):
    """Синхронно (~20–40 с с LLM): шпаргалка по продукту и ответы на типовые вопросы для продавцов."""
    from . import sales_brief
    return sales_brief.generate(body.product)


@app.post("/api/sales-briefs/{brief_id}/send")
def send_sales_brief(brief_id: str):
    """Разослать справку отделу продаж на тестовую почту."""
    from . import sales_brief
    b = sales_brief.get(brief_id)
    if not b:
        raise HTTPException(404)
    return mailer.send(f"[мини ПМ] Справка для отдела продаж: {b.get('product')}", sales_brief.to_text(b))


@app.get("/api/sales-briefs")
def sales_briefs():
    from . import sales_brief
    return sales_brief.list_briefs()


@app.get("/api/sales-briefs/{brief_id}")
def get_sales_brief(brief_id: str):
    from . import sales_brief
    b = sales_brief.get(brief_id)
    if not b:
        raise HTTPException(404)
    return b


@app.get("/api/storefront/card")
def storefront_card(family: str = "KES"):
    """Живая карточка товара store.softline.ru: название, цены, текст."""
    from . import storefront
    return storefront.card_for(family) or {"ok": False, "error": f"Нет ссылки на карточку для {family}"}


# ------------------------------------------------------------------ поиск в интернете (Yandex Search API)
@app.get("/api/web/search")
def web_search(q: str, k: int = 5):
    return websearch.search(q, k)


# ------------------------------------------------------------------ Яндекс.Метрика (живой счётчик команды)
@app.get("/api/metrika/live")
def metrika_live(date1: str = "7daysAgo", date2: str = "today"):
    return metrika.fetch(date1, date2)


# ------------------------------------------------------------------ экономика
@app.get("/api/usage/tokens")
def tokens():
    return store.token_summary()


# ------------------------------------------------------------------ фронтенд (один URL стенда)
if (config.FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

if (config.FRONTEND_DIST / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = config.FRONTEND_DIST / path
        return FileResponse(f if path and f.is_file() else config.FRONTEND_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def placeholder():
        return HTMLResponse("<h1>мини ПМ</h1><p>API работает. Фронтенд в разработке. "
                            "<a href='/docs'>Документация API</a> · <a href='/api/signals'>Сигналы</a></p>")
