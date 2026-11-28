"""Приоритет бэклога по пользе: «соотносить результаты анализа с бэклогом, чтобы находить задачи, способные принести
больше пользы бизнесу» (из задачи). Балл считается кодом — прозрачно, с причинами; модель здесь не участвует.

Источники баллов (перекрёстная проверка — задача поднимается выше, если её подтверждают несколько источников):
- активный сигнал по метрике задачи (Метрика/продажи): Critical 5, High 3, Medium 2;
- метрика задачи в воронке сигнала продаж (связь «учёт корзины ↔ падение заказов»): +3;
- риск из проверки пути покупки в тестовом ЛК (S-…) касается метрики или темы задачи: +3;
- релиз задачи — главный кандидат расследования: +2 (задача сделана, но её результат стоит пересмотреть);
- интервью и сводка аналитика упоминают тему задачи: +1;
- задача ещё не сделана (New/In Progress/Reopened): ×1,5 — польза достижима сразу.
"""
from __future__ import annotations

from . import detector, store

PRIO_W = {"Critical": 5, "High": 3, "Medium": 2, "Low": 1}
# связь метрик задачи с воронкой сигнала продаж: что «объясняет» падение заказов
FUNNEL = {"cfg_add_to_cart_rate", "cfg_open", "cfg_option_share", "cfg_completion_rate", "cfg_step_dropoff", "family_orders_idx"}
# темы проверки пути покупки → метрики / ключевые слова задач
STORE_RISK_LINKS = {
    "S-02": ({"family_orders_idx"}, ("kaspersky",)),
    "S-03": ({"family_orders_idx"}, ("kaspersky",)),
    "S-05": ({"cfg_add_to_cart_rate"}, ("электронной торговли", "e-commerce")),
    "S-06": ({"lk_reco_click_visits", "lk_reco_ctr"}, ("рекоменда",)),
}


def _family(text: str) -> str | None:
    t = text.lower()
    if "kaspersky" in t or "kes" in t or "каспер" in t:
        return "KES"
    if "astra" in t or "астра" in t:
        return "Astra"
    return None


def rank() -> list[dict]:
    from .investigator import _analyst_evidence, store_check
    sigs = detector.detect_all()
    by_metric: dict[str, list[dict]] = {}
    for s in sigs:
        by_metric.setdefault(s.get("metric_id"), []).append(s)
    sales = [s for s in sigs if s.get("kind") == "sales_drop"]
    main_release = None
    if sales:
        from .investigator import _rank_releases
        rr = _rank_releases(sales[0])
        main_release = rr[0]["release_id"] if rr else None
    sc = store_check("KES") or {"items": []}
    risks = [i for i in sc["items"] if i.get("hypothesis")]
    analyst = _analyst_evidence("KES") or {"items": []}
    analyst_text = " ".join(f"{i.get('topic', '')} {i.get('finding', '')}" for i in analyst["items"]).lower()

    out = []
    for t in store.backlog():
        metrics = set(t.get("linked_metric_ids") or [])
        text = f"{t['title']} {t.get('description') or ''}".lower()
        score, reasons = 0.0, []
        fam = _family(text)
        for m in metrics:
            for s in by_metric.get(m, []):
                sf = s.get("family") or _family(str(s.get("product") or ""))
                if fam and sf and fam != sf:
                    continue  # сигнал по другому семейству (метрика общая, продукт другой)
                w = PRIO_W.get(s.get("priority"), 1)
                score += w
                reasons.append(f"+{w}: активный сигнал {s['id']} ({s.get('priority')}) по метрике {m}")
        if sales and metrics & FUNNEL:
            score += 3
            reasons.append(f"+3: метрика в воронке сигнала {sales[0]['id']} (падение заказов KES)")
        for r in risks:
            ms, kws = STORE_RISK_LINKS.get(r["id"], (set(), ()))
            where = t["title"].lower() if r["id"] in ("S-02", "S-03") else text  # UX-риски — только задачи про сам конфигуратор KES
            if metrics & ms or any(k in where for k in kws):
                score += 3
                reasons.append(f"+3: проверка в тестовом ЛК {r['id']} — {r['topic']}")
        if main_release and main_release in (t.get("release_id") or []):
            score += 2
            reasons.append(f"+2: релиз задачи {main_release} — главный кандидат расследования")
        if fam == "KES" and any(k in analyst_text for k in ("конфигуратор", "корзин")):
            score += 1
            reasons.append("+1: тема есть в интервью / сводке аналитика")
        open_ = t.get("status") != "Done"
        if open_ and score:
            score *= 1.5
            reasons.append("×1,5: задача не сделана — польза достижима сразу")
        action = ("взять в работу первой" if open_ else "пересмотреть результат: задача сделана, но связана с отклонением") \
            if score >= 6 else ("держать в плане" if open_ else "без действий")
        out.append({"task_id": t["task_id"], "title": t["title"], "status": t.get("status"), "priority": t.get("priority"),
                    "score": round(score, 1), "action": action, "reasons": reasons, "tags": t.get("tags", [])})
    return sorted(out, key=lambda x: -x["score"])
