"""Цифры эталонного кейса: детектор должен воспроизводить расчёт аналитика."""
from backend.app import detector


def _kes():
    return next(s for s in detector.detect_all() if s["id"] == "SIG-SALES-KES")


def test_kes_drop_matches_analyst():
    ch = _kes()["change"]
    assert ch["baseline_mean"] == 165.8
    assert ch["post_mean"] == 111.6
    assert ch["change_pct"] == -32.7


def test_control_astra_is_stable():
    ctrl = _kes()["control"]
    assert ctrl["family"] == "Astra"
    assert ctrl["stable"] is True
    assert abs(ctrl["change_pct"]) < 10


def test_spike_28_09_excluded_and_only_one():
    spikes = [p for p in detector.sales_series("KES")["points"] if p["spike"]]
    assert [p["week_start"] for p in spikes] == ["2026-09-28"]


def test_incomplete_last_week_is_flagged_not_dropped():
    pts = detector.sales_series("KES")["points"]
    assert pts[-1]["incomplete"] is True
    assert pts[-1]["value"] is not None


def test_no_sales_signal_for_stable_control_family():
    assert not any(s["id"] == "SIG-SALES-Astra" for s in detector.detect_all())


def test_unknown_family_series_is_empty_not_error():
    assert detector.sales_series("ЛК")["points"] == []
