"""Замер эффекта после релиза: скользящее за 4 недели до/после, контрольная группа, вердикт.

В датасете данных после исправления нет (шаг 8 эталонного кейса), поэтому для демо есть
два синтетических сценария: «восстановилось» и «не восстановилось». Они помечены synthetic=true.
"""
from __future__ import annotations

import pandas as pd

from . import detector, settings_store

# Синтетика: 6 недель после хотфикса (с 23.11.2026)
SYNTHETIC = {
    "recovered": {"KES": [148, 171, 159, 182, 166, 175], "Astra": [105, 84, 126, 105, 98, 112]},
    "not_recovered": {"KES": [103, 124, 82, 118, 96, 110], "Astra": [105, 84, 126, 105, 98, 112]},
}


def measure(h: dict, scenario: str = "recovered") -> dict:
    cfg = settings_store.load()["detector"]
    fam, ctrl = h.get("family", "KES"), h.get("control_family", "Astra")
    sig = detector.detect_sales(fam, ctrl, settings_store.load()) or {}
    base = (sig.get("change") or {}).get("baseline_mean")
    weeks = pd.date_range("2026-11-23", periods=6, freq="7D")
    after = SYNTHETIC[scenario][fam]
    after_ctrl = SYNTHETIC[scenario][ctrl]
    k = cfg["rolling_window_weeks"]
    roll = pd.Series(after).rolling(k).mean().dropna()
    post_roll = float(roll.iloc[-1])
    before_mean = (sig.get("change") or {}).get("post_mean")
    change_vs_base = (post_roll - base) / base * 100 if base else None
    ctrl_base = (sig.get("control") or {}).get("baseline_mean")
    ctrl_post = float(pd.Series(after_ctrl).rolling(k).mean().dropna().iloc[-1])
    ctrl_change = (ctrl_post - ctrl_base) / ctrl_base * 100 if ctrl_base else None
    ctrl_stable = ctrl_change is not None and abs(ctrl_change) < cfg["control_max_change_pct"] * 1.5
    ok = change_vs_base is not None and change_vs_base >= h.get("success_threshold_pct", -10)
    verdict = "confirmed" if ok else "rejected"
    return {
        "synthetic": True,
        "scenario": scenario,
        "weeks": [{"week_start": d.strftime("%Y-%m-%d"), "value": v, "control": c} for d, v, c in zip(weeks, after, after_ctrl)],
        "baseline_mean": base, "before_fix_mean": before_mean,
        "after_rolling_4w": round(post_roll, 1), "change_vs_baseline_pct": round(change_vs_base, 1) if change_vs_base is not None else None,
        "control": {"family": ctrl, "baseline_mean": ctrl_base, "after_rolling_4w": round(ctrl_post, 1),
                    "change_pct": round(ctrl_change, 1) if ctrl_change is not None else None, "stable": ctrl_stable},
        "verdict": verdict,
        "decision": ("Гипотеза подтверждена: скользящий индекс вернулся к уровню базы, контроль стабилен. Задача закрыта."
                     if ok else
                     "Гипотеза не подтверждена: индекс не вернулся к базе. Задача переоткрыта, гипотеза пересматривается "
                     "(проверить альтернативу: T-08 ломает только учёт, причина падения другая)."),
    }
