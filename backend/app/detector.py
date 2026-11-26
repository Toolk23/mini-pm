"""Детерминированный детектор сигналов («Радар»).

Вся статистика (скользящее среднее, разовые всплески, неполная неделя, контрольная группа,
окно релизов, разрывы учёта) считается здесь, без LLM. LLM потом только интерпретирует факты.
"""
from __future__ import annotations

import pandas as pd

from . import ingest, settings_store

VISIT_METRICS = {"cfg_family_views", "cfg_reach_rate", "lk_home_views"}  # визитные: после 29.09 несопоставимы
G04_DATE = pd.Timestamp("2026-09-29")
FAMILY_NAMES = {"KES": "Kaspersky Endpoint Security", "Astra": "Astra Linux Special Edition"}
FAMILY_PRODUCT = {"KES": "Конфигуратор Kaspersky", "Astra": "Конфигуратор Астра"}


def _r(x, n=1):
    return None if x is None or pd.isna(x) else round(float(x), n)


def _d(ts) -> str:
    return pd.Timestamp(ts).strftime("%d.%m.%Y")


# ---------------------------------------------------------------- продажи
def sales_series(family: str, cfg: dict | None = None) -> dict:
    """Недельный ряд + скользящее + пометки (всплески, неполная неделя)."""
    cfg = cfg or settings_store.load()["detector"]
    df = ingest.sales()
    s = df[df.family == family][["week_start", "orders_index", "comment"]].reset_index(drop=True).copy()
    s["incomplete"] = False
    s.loc[s.index[-1], "incomplete"] = True  # G-09: последняя неделя может быть неполной
    s["spike"] = False
    # Разовый всплеск: неделя выше медианы 8 предыдущих × spike_ratio, а следующие 2 недели
    # снова ниже этой медианы (резкий подъём и откат). Устойчивый рост всплеском не считается.
    v = s["orders_index"]
    med = v.rolling(8, min_periods=4).median().shift(1)
    nxt = v.shift(-1).rolling(2, min_periods=1).mean().shift(-1).fillna(v.shift(-1))
    s.loc[(v > med * cfg["spike_ratio"]) & (nxt < med), "spike"] = True
    s["rolling"] = s["orders_index"].rolling(cfg["rolling_window_weeks"], min_periods=cfg["rolling_window_weeks"]).mean()
    return {
        "family": family,
        "name": FAMILY_NAMES.get(family, family),
        "points": [
            {"week_start": r.week_start.strftime("%Y-%m-%d"), "value": _r(r.orders_index), "rolling": _r(r.rolling),
             "spike": bool(r.spike), "incomplete": bool(r.incomplete),
             "comment": None if pd.isna(r.comment) else r.comment}
            for r in s.itertuples()
        ],
        "_df": s,
    }


def _window_change(s: pd.DataFrame, split: pd.Timestamp, cfg: dict, windows: dict | None = None) -> dict | None:
    """windows — те же календарные периоды, что у сигнала (для контрольной группы)."""
    if windows:
        clean = s[~s.incomplete]
        base = clean[(clean.week_start >= windows["b0"]) & (clean.week_start <= windows["b1"])]
        post = clean[(clean.week_start >= windows["p0"]) & (clean.week_start <= windows["p1"])]
    else:
        clean = s[~s.spike & ~s.incomplete]
        base = clean[clean.week_start < split].tail(cfg["baseline_weeks"])
        post = clean[clean.week_start >= split]
    if len(base) < 4 or len(post) < cfg["min_post_weeks"]:
        return None
    b, p = base.orders_index.mean(), post.orders_index.mean()
    return {
        "baseline_mean": _r(b), "post_mean": _r(p), "change_pct": _r((p - b) / b * 100),
        "baseline_period": f"{_d(base.week_start.min())}–{_d(base.week_start.max())}",
        "post_period": f"{_d(post.week_start.min())}–{_d(post.week_start.max())}",
        "baseline_weeks": len(base), "post_weeks": len(post),
        "_w": {"b0": base.week_start.min(), "b1": base.week_start.max(),
               "p0": post.week_start.min(), "p1": post.week_start.max()},
    }


def _releases_near(split: pd.Timestamp, days: int) -> list[dict]:
    rel = ingest.releases()
    win = rel[(rel.release_date >= split - pd.Timedelta(days=days)) & (rel.release_date <= split + pd.Timedelta(days=days))]
    return [
        {"release_id": r.release_id, "date": _d(r.release_date), "type": r.release_type, "description": r.description,
         "affected_metrics": r.affected_metrics, "related_task_ids": r.related_task_ids}
        for r in win.itertuples()
    ]


def detect_sales(family: str, control: str, settings: dict) -> dict | None:
    cfg = settings["detector"]
    rule = settings["metrics"]["family_orders_idx"]
    if not rule.get("enabled", True):
        return None
    ser = sales_series(family, cfg)
    s = ser["_df"]
    # точка изменения: перебираем недели, оценка = падение × √(число недель после) —
    # предпочитаем устойчивое длинное падение, а не короткий провал на шуме
    best = None
    for split in s.week_start.iloc[-14:]:
        ch = _window_change(s, split, cfg)
        if not ch:
            continue
        score = ch["change_pct"] * ch["post_weeks"] ** 0.5
        if best is None or score < best[2]:
            best = (split, ch, score)
    if not best or best[1]["change_pct"] > -rule["threshold"]:
        return None
    split, ch, _ = best
    ctrl_ser = sales_series(control, cfg)
    windows = ch.pop("_w")
    ctrl = _window_change(ctrl_ser["_df"], split, cfg, windows)
    if ctrl:
        ctrl.pop("_w", None)
    spikes = s[s.spike]
    rolling_pts = s.dropna(subset=["rolling"])
    roll_before = rolling_pts[rolling_pts.week_start < split]["rolling"].tail(1)
    roll_after = rolling_pts[rolling_pts.week_start >= split]["rolling"]
    releases = _releases_near(split, cfg["release_window_days"])
    caveats = []
    for r in spikes.itertuples():
        caveats.append(f"Неделя {_d(r.week_start)} — разовый всплеск ({_r(r.orders_index)}), исключена из расчёта: это не эффект релиза.")
    last = s.iloc[-1]
    caveats.append(f"Последняя неделя ({_d(last.week_start)}, {_r(last.orders_index)}) может быть неполной — исключена.")
    caveats.append("Выводы сделаны по средним за периоды и скользящему среднему, а не по отдельным неделям: заказов мало, недели шумят.")
    caveats.append("В продажах только самостоятельные заказы: уход клиентов к менеджеру в данных не виден.")
    control_stable = ctrl is not None and abs(ctrl["change_pct"]) < cfg["control_max_change_pct"]
    return {
        "id": f"SIG-SALES-{family}",
        "kind": "sales_drop",
        "metric_id": "family_orders_idx",
        "product": FAMILY_NAMES[family],
        "family": family,
        "priority": rule["priority"],
        "title": f"Падение самостоятельных заказов {family}: {ch['change_pct']}% к базе",
        "change": ch,
        "split_week": _d(split),
        "rolling": {"before": _r(roll_before.iloc[0]) if len(roll_before) else None,
                    "after_min": _r(roll_after.min()), "after_last": _r(roll_after.iloc[-1]) if len(roll_after) else None},
        "threshold_pct": rule["threshold"],
        "control": {"family": control, "name": FAMILY_NAMES[control], **(ctrl or {}), "stable": control_stable,
                    "conclusion": ("Контроль стабилен — падение специфично для " + family) if control_stable
                    else "Контроль тоже изменился — возможна общая динамика магазина"},
        "release_candidates": releases,
        "caveats": caveats,
        "series": ser["points"],
        "control_series": ctrl_ser["points"],
    }


# ---------------------------------------------------------------- метрики Я.Метрики
def weekly_metric(metric_id: str, product: str | None = None) -> pd.DataFrame:
    df = ingest.metrics_data()
    d = df[df.metric_id == metric_id]
    if product:
        d = d[d["product"] == product]
    if d.empty:
        return pd.DataFrame(columns=["week", "value", "n"])
    d = d.assign(week=d.date.dt.to_period("W-SUN").dt.start_time)
    unit = d["unit"].dropna().iloc[0] if d["unit"].notna().any() else ""
    if unit == "ratio":
        g = d.assign(w=d.value * d.sample_size.fillna(1)).groupby("week").agg(w=("w", "sum"), n=("sample_size", "sum"))
        g["value"] = g.w / g.n.replace(0, pd.NA)
        if g["value"].max() is not pd.NA and g["value"].max() <= 1.0:
            g["value"] = g["value"] * 100  # в проценты
    else:
        g = d.groupby("week").agg(value=("value", "sum"), n=("sample_size", "sum"))
    return g.reset_index()[["week", "value", "n"]]


def detect_metric(metric_id: str, product: str, rule: dict, cfg: dict) -> dict | None:
    w = weekly_metric(metric_id, product)
    if len(w) < 3:
        return None
    w = w.iloc[:-1] if len(w) > 3 else w  # последняя неделя может быть неполной
    caveats = []
    if metric_id in VISIT_METRICS:
        caveats.append("Визитный показатель: с 29.09 несопоставим с прошлым периодом (G-04) — сравнение только внутри периода.")
        w = w[w.week >= G04_DATE] if (w.week >= G04_DATE).sum() >= 4 else w
    if rule["rule"] == "zero_week":
        zero = w[w.value == 0]
        if len(zero) == 0:
            return None
        return {"id": f"SIG-{metric_id}-{product}", "kind": "zero_weeks", "metric_id": metric_id, "product": product,
                "priority": rule["priority"],
                "title": f"{metric_id}: {len(zero)} нед. без событий из {len(w)}",
                "facts": {"zero_weeks": [_d(x) for x in zero.week], "weeks_total": len(w),
                          "last_values": [_r(x) for x in w.value.tail(6)]},
                "caveats": caveats}
    k = min(cfg["rolling_window_weeks"], len(w) // 2)
    if k < 2:
        return None
    base, cur = w.value.iloc[-2 * k:-k].mean(), w.value.iloc[-k:].mean()
    if pd.isna(base) or pd.isna(cur) or base == 0:
        return None
    pct = (cur - base) / base * 100
    pp = cur - base
    hit = ((rule["rule"] == "pct_drop" and pct <= -rule["threshold"]) or
           (rule["rule"] == "pp_drop" and pp <= -rule["threshold"]) or
           (rule["rule"] == "pct_rise" and pct >= rule["threshold"]))
    if not hit:
        return None
    return {"id": f"SIG-{metric_id}-{product}", "kind": "metric_change", "metric_id": metric_id, "product": product,
            "priority": rule["priority"], "title": f"{metric_id} ({product}): {_r(pct)}% за {k} нед.",
            "facts": {"baseline": _r(base, 2), "current": _r(cur, 2), "change_pct": _r(pct), "change_pp": _r(pp, 2),
                      "window_weeks": k}, "caveats": caveats}


PRIORITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def detect_all() -> list[dict]:
    st = settings_store.load()
    out = []
    for fam, ctrl in (("KES", "Astra"), ("Astra", "KES")):
        sig = detect_sales(fam, ctrl, st)
        if sig:
            out.append(sig)
    products = ingest.metrics_data()[["metric_id", "product"]].drop_duplicates()
    for r in products.itertuples():
        rule = st["metrics"].get(r.metric_id)
        if not rule or not rule.get("enabled", True):
            continue
        sig = detect_metric(r.metric_id, r.product, rule, st["detector"])
        if sig:
            out.append(sig)
    return sorted(out, key=lambda s: PRIORITY_ORDER.get(s["priority"], 9))


def gaps_for(metric_id: str, product: str | None = None) -> list[dict]:
    res = []
    for g in ingest.DATA_GAPS:
        scope = g["scope"]
        m, _, p = scope.partition(":")
        if m.endswith("*"):
            ok = metric_id.startswith(m[:-1])
        elif m == "visit_metrics":
            ok = metric_id in VISIT_METRICS
        else:
            ok = m == metric_id
        if ok and (not p or not product or p == product):
            res.append(g)
    return res
