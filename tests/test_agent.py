"""Агент без LLM: шаблонный отчёт, действия курьера, теги, справка, витрина."""
from backend.app import config, courier, detector, investigator, sales_brief, store, storefront


def _report(signal_id="SIG-SALES-KES"):
    sig = next(s for s in detector.detect_all() if s["id"] == signal_id)
    return investigator.investigate(sig, "INV-TEST")


def test_template_report_has_steps_and_main_candidate():
    rep = _report()
    assert rep["mode"] == "template"
    assert len(rep["steps"]) >= 6
    assert "R-09" in rep["summary"]


def test_store_check_becomes_top_hypothesis():
    rep = _report()
    assert "Продление" in rep["hypotheses"][0]["text"]
    assert rep["hypotheses"][0]["status"].startswith("подтверждено наблюдением")
    assert rep["store_check"]["checked_at"] == "2026-11-28"


def test_analyst_quotes_attached_to_external_sources_step():
    step6 = next(s for s in _report()["steps"] if s["n"] == 6)
    assert {q["id"] for q in step6["quotes"]} >= {"E-01", "E-05"}
    assert all(q["curated"] for q in step6["quotes"])


def test_metric_signal_report_has_no_none_or_zero_drop():
    for sig in detector.detect_all():
        if sig["kind"] == "sales_drop":
            continue
        rep = investigator.investigate(sig, "INV-M")
        assert "None" not in rep["summary"] and "на 0%" not in rep["summary"]


def test_courier_creates_tagged_task_and_raises_t08():
    applied = courier.apply(_report())
    assert config.AI_TAG in applied["task"]["tags"]
    assert any(r["task_id"] == "T-08" for r in applied["raised"])
    t08 = next(t for t in store.backlog() if t["task_id"] == "T-08")
    assert "изменена ИИ-помощником" in t08["tags"]
    assert applied["email"]["sent"]["ok"] is False  # SMTP в тестах выключен — письмо только в outbox


def test_manual_change_does_not_get_ai_tag():
    t = store.backlog()[0]
    before = list(t["tags"])
    updated = store.update_task(t["task_id"], status="In Progress")  # по умолчанию by="pm"
    assert updated["tags"] == before
    assert updated["history"][-1]["by"] == "pm"


def test_sales_brief_template_and_faq():
    b = sales_brief.generate("KES")
    assert b["mode"] == "template"
    assert b["tag"] == config.AI_TAG
    assert len(sales_brief.analyst_faq()) == 15
    assert b["evidence"]["store_check"] is not None


def test_storefront_falls_back_to_snapshot():
    card = storefront.card_for("KES")
    assert card["live"] is False and 23220 in card["prices_rub"]
    assert "не виден" in card["issues"][0]


def test_backlog_ranking_puts_kes_tasks_first():
    from backend.app import prioritizer
    top = [r["task_id"] for r in prioritizer.rank()[:2]]
    assert set(top) == {"T-07", "T-08"}
    t08 = next(r for r in prioritizer.rank() if r["task_id"] == "T-08")
    assert t08["action"] == "взять в работу первой" and t08["reasons"]
