"""Настраиваемые параметры детектора (требование заказчика №3). Хранятся в data/state/settings.json."""
from __future__ import annotations

import copy
import json
import threading

from . import config

_LOCK = threading.Lock()
_PATH = config.STATE_DIR / "settings.json"

# Правила по умолчанию — переведены из колонки bad_signal листа «Метрики_справочник».
# rule: pct_drop — падение в % к базе; pp_drop — падение в п.п.; pct_rise — рост в %; zero_week — неделя без событий.
DEFAULT_SETTINGS = {
    "detector": {
        "rolling_window_weeks": 4,      # выводы только по скользящему среднему
        "baseline_weeks": 13,           # база: N полных недель до точки изменения
        "min_post_weeks": 3,            # минимум полных недель после изменения
        "spike_ratio": 1.35,            # неделя > медианы базы × ratio — разовый всплеск, исключаем
        "release_window_days": 14,      # релизы-кандидаты: ± дней от точки изменения
        "control_max_change_pct": 10,   # контроль «стабилен», если |изменение| меньше этого
    },
    "sources_weights": {"metrika": 0.4, "backlog": 0.25, "interviews": 0.2, "competitors": 0.15},
    "metrics": {
        "family_orders_idx": {"enabled": True, "rule": "pct_drop", "threshold": 20, "priority": "Critical"},
        "cfg_family_views": {"enabled": True, "rule": "pct_drop", "threshold": 20, "priority": "Medium"},
        "cfg_open": {"enabled": True, "rule": "pct_drop", "threshold": 20, "priority": "High"},
        "cfg_reach_rate": {"enabled": True, "rule": "pp_drop", "threshold": 5, "priority": "High"},
        "cfg_completion_rate": {"enabled": True, "rule": "pp_drop", "threshold": 5, "priority": "High"},
        "cfg_back_reset_rate": {"enabled": True, "rule": "pct_rise", "threshold": 30, "priority": "Medium"},
        "cfg_add_to_cart_rate": {"enabled": True, "rule": "pp_drop", "threshold": 3, "priority": "Critical"},
        "lk_home_views": {"enabled": True, "rule": "pct_drop", "threshold": 30, "priority": "Medium"},
        "lk_reco_status_visits": {"enabled": True, "rule": "pct_drop", "threshold": 30, "priority": "Medium"},
        "lk_reco_shown_share": {"enabled": True, "rule": "pp_drop", "threshold": 10, "priority": "High"},
        "lk_reco_click_visits": {"enabled": True, "rule": "zero_week", "threshold": 0, "priority": "High"},
        "lk_reco_ctr": {"enabled": True, "rule": "pct_drop", "threshold": 30, "priority": "High"},
    },
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load() -> dict:
    with _LOCK:
        if _PATH.exists():
            return _merge(DEFAULT_SETTINGS, json.loads(_PATH.read_text("utf-8")))
        return copy.deepcopy(DEFAULT_SETTINGS)


def save(patch: dict) -> dict:
    current = load()
    merged = _merge(current, patch)
    with _LOCK:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), "utf-8")
    return merged


def reset() -> dict:
    with _LOCK:
        if _PATH.exists():
            _PATH.unlink()
    return load()
