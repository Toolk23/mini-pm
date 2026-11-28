"""«Следователь»: по сигналу собирает доказательства из всех источников и формирует отчёт.

Детерминированная часть (факты, окно релизов, воронка, пробелы данных, бэклог, поиск по интервью и
конкурентам) работает всегда. LLM только интерпретирует готовые факты: гипотезы, рекомендация,
письмо ПМу. Без ключа LLM отчёт собирается по шаблону — демо не ломается.
"""
from __future__ import annotations

import json

import pandas as pd

from . import config, detector, ingest, llm, store

FAMILY_KEYWORDS = {"KES": ["kaspersky", "касперск", "kes"], "Astra": ["astra", "астра"]}


def _search(query: str, k: int = 4, source: str | None = None) -> list[dict]:
    try:
        from .rag import get_index
        hits = get_index(config.DATA_DIR).search(query, k=k, source_types=[source] if source else None)
    except Exception:  # noqa: BLE001 — модуль поиска мог ещё не собраться
        return []
    return [{k_: h.get(k_) for k_ in ("id", "source_type", "file", "sheet", "row", "title", "text", "score")} for h in hits]


# ------------------------------------------------------------------ шаги расследования
def _rank_releases(sig: dict) -> list[dict]:
    fam = (family_of(sig) or "KES")
    kw = FAMILY_KEYWORDS.get(fam, [])
    control_stable = sig.get("control", {}).get("stable")
    out = []
    for r in sig.get("release_candidates", []):
        desc = (r["description"] or "").lower()
        affects_family = any(k in desc for k in kw)
        lk_only = all(m.startswith("lk_") for m in r["affected_metrics"]) if r["affected_metrics"] else False
        if r["type"] == "marketing":
            score, why = 0.0, "Отсеян: рассылка, не релиз продукта; касается ЛК, а не витрины семейства."
        elif lk_only:
            score, why = 0.05, "Отсеян: изменения затрагивают только личный кабинет, а не страницы и конфигуратор семейства."
        elif affects_family:
            score, why = 0.8, "Главный кандидат: релиз меняет путь покупки именно этого семейства и попадает в окно падения."
        elif r["type"] == "infrastructure":
            score = 0.15 if control_stable else 0.5
            why = ("Фактор, но не основное объяснение: изменение затронуло весь магазин и задело бы контрольное семейство, "
                   "а контроль стабилен. Визитные метрики после этой даты несопоставимы.")
        else:
            score, why = 0.1, "Слабый кандидат: не затрагивает метрики этого семейства."
        out.append({**r, "score": score, "why": why})
    return sorted(out, key=lambda x: -x["score"])


def _funnel(sig: dict) -> dict:
    product = detector.FAMILY_PRODUCT.get((family_of(sig) or "KES"))
    split = pd.Timestamp(pd.to_datetime(sig["split_week"], dayfirst=True))
    md = ingest.metrics_data()
    res = {}
    for m in ("cfg_family_views", "cfg_open", "cfg_reach_rate"):
        w = detector.weekly_metric(m, product)
        if w.empty:
            res[m] = {"status": "no_data"}
            continue
        w = w.iloc[:-1]
        before, after = w[w.week < split].tail(6), w[w.week >= split + pd.Timedelta(days=7)]
        res[m] = {"before_mean": round(float(before.value.mean()), 1) if len(before) else None,
                  "after_mean": round(float(after.value.mean()), 1) if len(after) else None,
                  "weeks_after": len(after),
                  "note": "визитный показатель: после 29.09 несопоставим с прошлым" if m in detector.VISIT_METRICS
                  else ("событий до релиза нет: конфигуратор этого семейства появился в самом релизе, "
                        "поэтому сравнения до/после нет — это не пропуск учёта" if not len(before) else "")}
    a2c = md[(md.metric_id == "cfg_add_to_cart_rate") & (md["product"] == product)]
    res["cfg_add_to_cart_rate"] = {"status": "not_measured" if a2c.empty else "measured", "rows": int(len(a2c))}
    return res


def _backlog_links(sig: dict) -> list[dict]:
    fam_kw = FAMILY_KEYWORDS.get((family_of(sig) or "KES"), [])
    out = []
    for t in store.backlog():
        text = f"{t['title']} {t.get('description') or ''}".lower()
        linked = ("cfg_add_to_cart_rate" in t.get("linked_metric_ids", []) or sig["metric_id"] in t.get("linked_metric_ids", [])
                  or any(k in text for k in fam_kw))
        if linked:
            out.append({k: t.get(k) for k in ("task_id", "title", "status", "priority", "linked_metric_ids", "description")})
    return out


def family_of(sig: dict) -> str | None:
    """Семейство сигнала: у сигналов продаж — поле family, у метрик — по продукту (Конфигуратор Астра → Astra)."""
    if sig.get("family"):
        return sig["family"]
    rev = {v: k for k, v in detector.FAMILY_PRODUCT.items()}
    return rev.get(sig.get("product") or "")


def collect_evidence(sig: dict) -> dict:
    fam = family_of(sig) or "KES"
    name = sig.get("product") or fam
    gaps = detector.gaps_for("family_orders_idx") + detector.gaps_for("cfg_add_to_cart_rate", detector.FAMILY_PRODUCT.get(fam))
    gaps += detector.gaps_for("cfg_family_views")
    seen, uniq = set(), []
    for g in gaps:
        if g["id"] not in seen:
            seen.add(g["id"])
            uniq.append(g)
    interview_q = [f"{name.split()[0]} лицензия подбор покупка", "сложно выбрать лицензию конфигуратор", "оформление заказа корзина счёт"]
    analyst = _analyst_evidence(fam)
    competitor_q = [f"{name.split()[0]} цена", "конфигуратор подбор лицензии", "оформление заказа шаги"]
    return {
        "signal": {k: v for k, v in sig.items() if k not in ("series", "control_series", "release_candidates")},
        "releases": _rank_releases(sig) if sig.get("kind") == "sales_drop" else [],
        "funnel": _funnel(sig) if sig.get("kind") == "sales_drop" else {},
        "backlog": _backlog_links(sig),
        "data_gaps": uniq,
        "interviews": _quotes(analyst, "interview") + [h for q in interview_q for h in _search(q, 3, "interview")],
        "competitors": _quotes(analyst, "competitor") + [h for q in competitor_q for h in _search(q, 3, "competitor")],
        "analyst_evidence": analyst,
        "store_check": store_check(fam),
        "web": _web(sig),
        "reference_case_traps": ingest.reference_case()["traps"],
    }


def _analyst_evidence(fam: str) -> dict | None:
    """Проверенная аналитиком сводка внешних источников (data/curated/evidence_<семейство>.json)."""
    p = config.DATA_DIR / "curated" / f"evidence_{ {'KES': 'kaspersky', 'Astra': 'astra'}.get(fam, fam.lower()) }.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else None


def store_check(fam: str | None) -> dict | None:
    """Проверка пути покупки на живом магазине в тестовом ЛК (data/curated/store_check_<семейство>.json)."""
    p = config.DATA_DIR / "curated" / f"store_check_{(fam or '').lower()}.json"
    return json.loads(p.read_text("utf-8")) if fam and p.exists() else None


def _quotes(analyst: dict | None, kind: str) -> list[dict]:
    """Точные цитаты из сводки аналитика — в том же формате, что фрагменты поиска, но первыми в списке.
    Поиск по интервью находит в основном профили респондентов, а здесь — высказывания по сути с выводом."""
    if not analyst:
        return []
    out = []
    for it in analyst.get("items", []):
        src = it.get("source", {})
        fname = (src.get("file", "") + " " + src.get("inner", "")).lower()
        interview_files = [f.name.lower() for f in (config.RAW_DIR / "interviews").glob("*.xlsx")]
        if "интервью" in fname or "транскриб" in fname or any(f in fname for f in interview_files):
            src_kind = "interview"
        elif "конкурент" in fname:
            src_kind = "competitor"
        else:
            continue  # датасет и прочее — только в сводке analyst_evidence
        if src_kind != kind:
            continue
        out.append({"id": it["id"], "source_type": kind, "file": src.get("inner") or src.get("file"),
                    "sheet": src.get("sheet"), "row": src.get("row"), "title": it.get("topic"),
                    "text": it.get("quote"), "finding": it.get("finding"),
                    "supports_hypothesis": it.get("supports_hypothesis"), "score": None, "curated": True})
    return out


def _web(sig: dict) -> list[dict]:
    """Свежий внешний контекст из Yandex Search API (если настроен): что видит покупатель в поиске."""
    from . import websearch
    if not websearch.configured() or sig.get("kind") != "sales_drop":
        return []
    name = sig.get("product", sig.get("family", ""))
    out = []
    for q in (f"купить {name} лицензия", f"{name} конфигуратор подбор лицензии"):
        res = websearch.search(q, 4)
        out += [{**r, "query": q} for r in res["results"]]
    return out


# ------------------------------------------------------------------ отчёт
SYSTEM = """Ты — «мини ПМ», ИИ-помощник продакт-менеджера интернет-магазина store.softline.ru.
Ты расследуешь отклонения метрик. Правила:
1. Опирайся ТОЛЬКО на переданные факты и цитаты. Ничего не выдумывай. Если данных нет — так и пиши: «нет данных» / «не подтверждено внешними источниками».
2. «Нет данных» ≠ ноль. Если метрика не измеряется, не делай выводов о её значении.
3. Выводы — только по средним за периоды и скользящему среднему, не по отдельным неделям.
4. Каждое утверждение — со ссылкой на источник (лист, файл, строка, id задачи/релиза).
5. Пиши по-русски, коротко и по делу, как опытный продакт-аналитик.
6. Результаты поиска Яндекса (web) — внешний контекст, а не данные магазина: ссылайся на URL и не делай по ним выводов о причине падения без подтверждения в данных. Вывод аналитика (analyst_evidence) — проверенная сводка внешних источников.
7. store_check — проверка пути покупки на живом магазине в тестовом ЛК (дата, факты S-01…): это наблюдения, а не замер.
   Используй их в шаге про воронку и в гипотезах, ссылайся на S-id; причину по-прежнему называй «главным кандидатом».
Верни строго JSON."""

SCHEMA_HINT = """{
 "summary": "2-3 предложения: что случилось и главный вывод",
 "steps": [{"n":1,"title":"...","finding":"...","sources":["Продажи", "..."]}],
 "hypotheses": [{"text":"...","check":"как проверить","status":"не проверена|частично подтверждена|подтверждена|опровергнута"}],
 "sources_check": {"metrika":"подтверждает|частично|нет данных","backlog":"...","interviews":"...","competitors":"...","web":"...", "comment":"..."},
 "recommendation": "что сделать",
 "task": {"title":"...","description":"...","priority":"Critical|High|Medium"},
 "raise_tasks": [{"task_id":"T-08","new_priority":"High","why":"..."}],
 "success_criterion": "...",
 "closing_rule": "...",
 "email": {"subject":"...","body":"текст письма ПМу"}
}
Требования: steps — 6–8 шагов, как у следователя (сигнал, контроль, окно релизов, воронка, пробелы данных, внешние источники, итог); hypotheses — минимум 2. Только валидный JSON без комментариев."""


def _template_report(ev: dict) -> dict:
    """Отчёт без LLM — по шаблону эталонного кейса, из детерминированных фактов."""
    if ev["signal"].get("kind") != "sales_drop":
        return _template_metric_report(ev)
    s = ev["signal"]
    ch, ctrl = s.get("change", {}), s.get("control", {})
    rel = ev["releases"]
    main = rel[0] if rel else None
    others = [r for r in rel[1:]]
    t08 = next((t for t in ev["backlog"] if "cfg_add_to_cart_rate" in (t.get("linked_metric_ids") or []) and t["status"] != "Done"), None)
    f = ev["funnel"]
    steps = [
        {"n": 1, "title": "Сигнал", "sources": ["Продажи"],
         "finding": f"Средний индекс самостоятельных заказов {s.get('family')} за {ch.get('post_period')} — {ch.get('post_mean')} "
                    f"против {ch.get('baseline_mean')} за {ch.get('baseline_period')} ({ch.get('change_pct')}%). "
                    f"Скользящее за 4 недели: {s.get('rolling', {}).get('before')} → {s.get('rolling', {}).get('after_min')}–{s.get('rolling', {}).get('after_last')}."},
        {"n": 2, "title": "Контрольная группа", "sources": ["Продажи"],
         "finding": f"{ctrl.get('name')} за те же периоды: {ctrl.get('change_pct')}%. {ctrl.get('conclusion')}."},
        {"n": 3, "title": "Окно релизов", "sources": ["Релизы"],
         "finding": (f"Главный кандидат — {main['release_id']} ({main['date']}): {main['why']} " if main else "Релизов в окне нет. ")
                    + " ".join(f"{r['release_id']}: {r['why']}" for r in others)},
        {"n": 4, "title": "Где теряем клиентов", "sources": ["Метрики_данные", "Метрики_справочник"],
         "finding": f"Визиты на страницы семейства до/после: {f.get('cfg_family_views', {}).get('before_mean')} / {f.get('cfg_family_views', {}).get('after_mean')} "
                    f"(визитный показатель, после 29.09 несопоставим). Использование конфигуратора после релиза: в среднем "
                    f"{f.get('cfg_open', {}).get('after_mean')} визитов с выбором опций в неделю, доля открывших {f.get('cfg_reach_rate', {}).get('after_mean')}%. "
                    "Спрос на страницах сохранился — проблема между выбором лицензии и оформлением заказа."},
        {"n": 5, "title": "Пробел в данных", "sources": ["Метрики_справочник", "Бэклог_задачи"],
         "finding": "Добавление в корзину из конфигуратора для этого семейства не измеряется — это пометка, а не «конверсия равна нулю». "
                    + (f"Открыта задача {t08['task_id']} «{t08['title']}» (приоритет: {t08['priority']})." if t08 else "")},
        {"n": 6, "title": "Внешние источники", "sources": ["Интервью", "Конкурентный анализ"],
         "quotes": [q for q in ev["interviews"] + ev["competitors"] if q.get("curated")],
         "finding": (f"Интервью: найдено {len(ev['interviews'])} фрагментов по теме подбора и покупки лицензий, "
                     f"из них {sum(1 for q in ev['interviews'] if q.get('curated'))} — проверенные цитаты аналитика. " if ev["interviews"] else
                     "Интервью: прямых упоминаний не найдено — не подтверждено внешними источниками. ")
                    + (f"Конкуренты: {len(ev['competitors'])} фрагментов. " if ev["competitors"] else "Конкуренты: данных нет. ")
                    + (f"Вывод аналитика по внешним источникам: {ev['analyst_evidence']['verdict']} " if ev.get("analyst_evidence") else "")
                    + (f"Поиск Яндекса: {len(ev['web'])} результатов." if ev.get("web") else "")},
    ]
    return {
        "summary": f"Устойчивое падение самостоятельных заказов {s.get('family')} на {abs(ch.get('change_pct') or 0)}% после "
                   f"{main['release_id'] if main else 'изменения'}; контроль стабилен. Потеря — между выбором лицензии и заказом, участок воронки не измеряется.",
        "steps": steps,
        "hypotheses": [
            {"text": "Путь от выбора в конфигураторе до корзины сломан или неудобен", "status": "не проверена",
             "check": "Ручная проверка пути «конфигуратор → корзина» на 3 семействах KES и разных устройствах"},
            {"text": f"{t08['task_id'] if t08 else 'T-08'} ломает только учёт, а причина падения другая", "status": "не проверена",
             "check": "Сравнить заказы по логам оплат с событиями Метрики; починить передачу событий e-commerce"},
        ],
        "sources_check": {"metrika": "подтверждает", "backlog": "подтверждает (открытая задача по учёту)" if t08 else "нет связанных задач",
                          "interviews": "частично" if ev["interviews"] else "нет данных",
                          "competitors": "частично" if ev["competitors"] else "нет данных",
                          "comment": "Режим без LLM: отчёт собран по шаблону из детерминированных фактов."},
        "recommendation": "Создать задачу на ручную проверку пути от выбора в конфигураторе до корзины; поднять приоритет задачи по передаче событий e-commerce.",
        "task": {"title": f"Проверить путь «конфигуратор → корзина» для {s.get('family')} после {main['release_id'] if main else 'релиза'}",
                 "description": "Ручная проверка пути от выбора в конфигураторе до корзины на трёх семействах и разных устройствах. "
                                f"Сигнал: заказы {ch.get('change_pct')}% к базе, контроль стабилен.", "priority": "Critical"},
        "raise_tasks": [{"task_id": t08["task_id"], "new_priority": "High", "why": "без событий корзины нельзя локализовать потерю"}] if t08 else [],
        "success_criterion": f"Скользящий индекс заказов {s.get('family')} за 4 недели вернулся к уровню базы ({ch.get('baseline_mean')}); контроль — {ctrl.get('name')}.",
        "closing_rule": "Индекс вернулся — задача закрыта. Не вернулся — гипотеза пересматривается.",
        "email": {"subject": f"[мини ПМ] {s.get('title')}",
                  "body": f"Сигнал: {s.get('title')}.\nКонтроль: {ctrl.get('conclusion')}.\nГлавный кандидат: {main['release_id'] if main else '—'}.\n"
                          "Предлагаю: задачу на проверку пути «конфигуратор → корзина» и поднять приоритет задачи по событиям e-commerce.\n"
                          "Подробности — в отчёте расследования."},
    }


def _template_metric_report(ev: dict) -> dict:
    """Шаблон для сигналов по метрикам (не продажи): без «заказов None на 0%»."""
    s = ev["signal"]
    f = s.get("facts") or {}
    title, metric, product = s.get("title", "Сигнал"), s.get("metric_id"), s.get("product") or "—"
    zero = s.get("kind") == "zero_weeks"
    what = (f"Недели без событий: {', '.join(f.get('zero_weeks', [])[:6])}" if zero
            else f"Среднее за {f.get('window_weeks')} нед.: база {f.get('baseline')} → сейчас {f.get('current')}")
    title = title.rstrip(".")
    rel = ingest.releases()
    near = [r for r in rel.itertuples() if metric in r.affected_metrics]
    links = ev.get("backlog") or []
    steps = [
        {"n": 1, "title": "Что изменилось", "sources": ["Метрики_данные"], "finding": f"{title}: {what}."},
        {"n": 2, "title": "Это сбой учёта или поведение?", "sources": ["Метрики_справочник", "Реестр разрывов"],
         "finding": ("Недели с нулём событий — сначала проверить передачу событий: «нет данных» ≠ ноль. " if zero else
                     "Изменение посчитано по средним за окна, а не по отдельной неделе. ") + " ".join(s.get("caveats", []))},
        {"n": 3, "title": "Релизы, затрагивающие метрику", "sources": ["Релизы"],
         "finding": ("; ".join(f"{r.release_id} ({r.release_date:%d.%m}) — {r.description}" for r in near[:4]) or
                     "Релизов, затрагивающих эту метрику, нет.")},
        {"n": 4, "title": "Связанные задачи бэклога", "sources": ["Бэклог_задачи"],
         "finding": "; ".join(f"{t['task_id']} «{t['title']}» ({t['status']}, {t['priority']})" for t in links[:4]) or "Связанных задач нет."},
        {"n": 5, "title": "Пробелы в данных", "sources": ["Реестр разрывов"],
         "finding": "; ".join(g["text"] for g in ev.get("data_gaps", [])[:3]) or "Известных разрывов нет."},
    ]
    return {
        "summary": f"{title}. {what}. Нужна проверка: сбой учёта или реальное изменение поведения ({product}).",
        "steps": steps,
        "hypotheses": [
            {"text": f"Сбой передачи событий метрики {metric}", "status": "не проверена",
             "check": "Сверить сырые события Метрики за недели сигнала с логами сайта"},
            {"text": "Реальное изменение поведения пользователей после релиза", "status": "не проверена",
             "check": "Сравнить с контрольным продуктом за те же недели"},
        ],
        "sources_check": {"metrika": "подтверждает сигнал", "backlog": "есть связанные задачи" if links else "нет связанных задач",
                          "interviews": "нет данных", "competitors": "нет данных",
                          "comment": "Режим без LLM: отчёт собран по шаблону из детерминированных фактов."},
        "recommendation": f"Проверить учёт метрики {metric} ({product}); если учёт исправен — разобрать связанный релиз.",
        "task": {"title": f"Проверить учёт и динамику {metric} ({product})", "priority": s.get("priority", "High"),
                 "description": f"Сигнал: {title}. {what}."},
        "raise_tasks": [],
        "success_criterion": f"Метрика {metric} ({product}) без недель с нулём и в пределах порога к базе.",
        "closing_rule": "Учёт исправен и метрика в норме — задача закрыта; иначе — пересмотр гипотезы.",
        "email": {"subject": f"[мини ПМ] {title}", "body": f"Сигнал: {title}.\n{what}.\nПроверить учёт, затем связанный релиз."},
    }


def investigate(sig: dict, inv_id: str) -> dict:
    ev = collect_evidence(sig)
    mode = "llm"
    if llm.available():
        facts = json.dumps(ev, ensure_ascii=False, default=str)[:24000]
        try:
            rep = llm.chat_json(
                [{"role": "system", "content": SYSTEM},
                 {"role": "user", "content": f"Факты и доказательства (JSON):\n{facts}\n\nСформируй отчёт расследования в формате:\n{SCHEMA_HINT}"}],
                step="investigation", max_tokens=16000, request_id=inv_id)
        except llm.LLMError as e:
            rep, mode = _template_report(ev), f"template (LLM error: {e})"
    else:
        rep, mode = _template_report(ev), "template"
    sc = ev.get("store_check")
    sig_ev = ev.get("signal", {})
    if sc and sig_ev.get("metric_id") == "lk_reco_click_visits":
        s06 = next((i for i in sc["items"] if i["id"] == "S-06"), None)
        if s06:
            rep.setdefault("hypotheses", []).insert(0, {"text": s06["hypothesis"], "status": "подтверждено наблюдением, не замером",
                                                        "check": "Сверить клики в ЛК (счётчик 95059120) с визитами utm_campaign=reco "
                                                                 "в магазине (44242089) за недели с нулём [S-06]"})
            rep["store_check"] = {"checked_at": sc["checked_at"], "verdict": s06["fact"], "risks": [s06]}
        sc = None
    elif sig_ev.get("kind") != "sales_drop":
        sc = None
    if sc and isinstance(rep.get("steps"), list):
        # проверка на живом магазине — детерминированно, независимо от того, что написала модель
        risks = [i for i in sc["items"] if i.get("hypothesis")]
        note = (f" Проверка на живом магазине ({sc['checked_at']}, тестовый ЛК): {sc['verdict']}")
        for st in rep["steps"]:
            if isinstance(st, dict) and (st.get("n") == 4 or "воронк" in str(st.get("title", "")).lower()):
                st["finding"] = (st.get("finding") or "") + note
                st.setdefault("sources", []).append("Тестовый ЛК store.softline.ru")
                break
        hs = rep.setdefault("hypotheses", [])
        if not any("продлени" in str(h.get("text", "")).lower() for h in hs if isinstance(h, dict)):
            hs.insert(0, {"text": "По умолчанию на карточке KES выбрано «Продление», а на оформлении продления нужен скан "
                                  "предыдущей лицензии — новые клиенты обрываются на последнем шаге",
                          "status": "подтверждено наблюдением, не замером",
                          "check": "A/B: по умолчанию «Полная версия»; сравнить долю самостоятельных заказов KES с контролем Astra "
                                   "[S-02, S-03]"})
        for h in hs:
            if isinstance(h, dict) and "корзин" in str(h.get("text", "")).lower() and "слом" in str(h.get("text", "")).lower():
                h["status"] = "проверена в тестовом ЛК: путь до корзины работает"
        rep["store_check"] = {"checked_at": sc["checked_at"], "verdict": sc["verdict"],
                              "risks": [{"id": i["id"], "fact": i["fact"], "hypothesis": i["hypothesis"]} for i in risks]}
    quotes = [q for q in ev["interviews"] + ev["competitors"] if q.get("curated")]
    for st in rep.get("steps", []) or []:  # цитаты аналитика — в шаг «Внешние источники» и в LLM-, и в шаблонном режиме
        if isinstance(st, dict) and (st.get("n") == 6 or "внешн" in str(st.get("title", "")).lower()):
            st["quotes"] = quotes
    return {"id": inv_id, "mode": mode, "created_at": store.now(), "evidence": ev, **rep}


# ------------------------------------------------------------------ чат
CHAT_SYSTEM = SYSTEM.replace("Верни строго JSON.", (
    "Сначала опирайся на блок «Факты из данных» (продажи, контрольная группа, релизы, итоги расследований) — "
    "это первичные данные магазина. Причину называй «главным кандидатом» или гипотезой, а не доказанным фактом, "
    "пока гипотеза не проверена замером. Интервью и конкуренты — только как подтверждение или контекст, не как причина "
    "падения, если факты указывают на другое. Если по вопросу есть расследование — пересказывай его вывод. "
    "Отвечай обычным текстом; ссылайся на сигналы/релизы/расследования по id, на фрагменты базы — [1], [2]."))


def _mentioned_families(text: str) -> set[str]:
    t = text.lower()
    return {f for f, kws in FAMILY_KEYWORDS.items() if any(k in t for k in kws)}


def _signal_facts(sig: dict) -> dict:
    if sig.get("kind") != "sales_drop":
        return {k: sig.get(k) for k in ("id", "title", "priority", "facts", "caveats")}
    ctrl = sig.get("control", {})
    return {
        "id": sig["id"], "title": sig["title"], "priority": sig["priority"],
        "change": sig["change"], "split_week": sig["split_week"], "rolling": sig["rolling"],
        "control": {k: ctrl.get(k) for k in ("family", "change_pct", "baseline_period", "post_period", "stable", "conclusion")},
        "releases_ranked": [{k: r.get(k) for k in ("release_id", "date", "type", "description", "score", "why")}
                            for r in _rank_releases(sig)],
        "caveats": sig.get("caveats", []),
    }


def _investigation_digest(signal_id: str) -> dict | None:
    done = [j for j in store.read("investigations", {}).values()
            if j.get("signal_id") == signal_id and j.get("status") == "done"]
    if not done:
        return None
    j = max(done, key=lambda x: x.get("created_at", ""))
    r = j.get("report", {})
    return {"investigation_id": j["id"], "mode": r.get("mode"), "summary": r.get("summary"),
            "hypotheses": [{k: h.get(k) for k in ("text", "status")} for h in r.get("hypotheses", [])],
            "recommendation": r.get("recommendation"), "applied": bool(j.get("applied"))}


def chat_facts(message: str) -> dict:
    """Факты из данных для чата: подробно — по упомянутым семействам (или по критичным сигналам), кратко — остальные."""
    sigs = detector.detect_all()
    fams = _mentioned_families(message)
    focus = [s for s in sigs if s.get("family") in fams] if fams else \
        [s for s in sigs if s.get("priority") == "Critical"][:2]
    detailed = []
    for s in focus:
        f = _signal_facts(s)
        inv = _investigation_digest(s["id"])
        if inv:
            f["investigation"] = inv
        detailed.append(f)
    focus_ids = {s["id"] for s in focus}
    others = [{k: s.get(k) for k in ("id", "title", "priority")} for s in sigs if s["id"] not in focus_ids]
    out = {"signals_detailed": detailed, "other_signals": others}
    checks = {f: store_check(f) for f in (fams or {"KES"})}
    checks = {f: c for f, c in checks.items() if c}
    if checks:
        out["store_check"] = checks  # проверка пути покупки в тестовом ЛК
    return out


WEB_TRIGGERS = ("интернет", "в сети", "поищи", "погугли", "загугли", "найди в", "рынок", "конкурент", "яндекс", "сейчас на сайт")


def answer(message: str, history: list[dict]) -> dict:
    hits = _search(message, 6)
    facts = chat_facts(message)
    from . import websearch
    if websearch.configured() and any(t in message.lower() for t in WEB_TRIGGERS):
        facts["web"] = websearch.search(message, 5)
    from . import sales_brief
    briefs = {f: sales_brief.latest_for(f) for f in _mentioned_families(message)}
    briefs = {f: {k: b.get(k) for k in ("id", "pitch", "key_points", "vs_competitors", "faq", "objections", "dont_say")}
              for f, b in briefs.items() if b}
    if briefs:
        facts["sales_brief"] = briefs
    faq = sales_brief.analyst_faq()
    if faq:
        facts["analyst_faq"] = faq[:30]  # типовые вопросы с проверенными ответами аналитика  # готовые ответы на типовые вопросы — до 50% вопросов повторяются
    ctx = "\n".join(f"[{i + 1}] {h['title']} ({h['file']}, лист {h['sheet']}, строка {h['row']}): {h['text']}" for i, h in enumerate(hits))
    if not llm.available():
        return {"answer": ("Режим без LLM. Нашёл в базе:\n" + ctx) if hits else "В базе нет данных по этому вопросу.",
                "sources": hits, "facts": facts, "mode": "search_only"}
    msgs = [{"role": "system", "content": CHAT_SYSTEM},
            *[m for m in history[-6:] if m.get("role") in ("user", "assistant")],
            {"role": "user", "content": f"Факты из данных:\n{json.dumps(facts, ensure_ascii=False, default=str)}\n\n"
                                        f"Фрагменты базы знаний (интервью, конкуренты):\n{ctx or 'ничего не найдено'}\n\nВопрос: {message}"}]
    try:
        text = llm.chat(msgs, step="chat", max_tokens=8000).strip()
    except llm.LLMError as e:
        return {"answer": f"LLM недоступна ({e}). Нашёл в базе:\n{ctx}", "sources": hits, "facts": facts, "mode": "search_only"}
    return {"answer": text, "sources": hits, "facts": facts, "mode": "llm"}
