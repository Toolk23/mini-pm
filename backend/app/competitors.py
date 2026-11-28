"""Положение Store на фоне конкурентов — итоговая матрица конкурентного исследования (лист «Итоги»).

Баллы 1–5 по блокам (поиск, цена, покупка/счёт, ЛК, сервис, UX) и веса блоков. Пустое значение («-») — нет данных,
не ноль. Для каждого блока: балл Store, лучший конкурент, разрыв и подтверждения из сводки аналитика (E-…).
"""
from __future__ import annotations

from functools import lru_cache

import openpyxl

from . import config

BLOCKS = ["Поиск", "Цена", "Покупка/счёт", "Личный кабинет", "Сервис", "UX"]
EVIDENCE = {"Поиск": ["E-03", "E-04"], "Цена": ["E-01", "E-02"], "Покупка/счёт": ["E-06", "E-07"], "UX": ["E-05"]}


def _num(v):
    return float(v) if isinstance(v, (int, float)) else None


@lru_cache(maxsize=1)
def matrix() -> dict:
    ws = openpyxl.load_workbook(config.RAW_DIR / "competitors.xlsx", read_only=True, data_only=True)["Итоги"]
    rows = list(ws.iter_rows(min_row=1, max_row=40, values_only=True))
    weights = {b: _num(v) for b, v in zip(BLOCKS, rows[3][1:7])}
    shops = []
    for r in rows[7:18]:  # «Без учёта веса»: строки 8–18
        if not r[0]:
            continue
        shops.append({"shop": r[0], "scores": {b: _num(v) for b, v in zip(BLOCKS, r[1:7])}, "total": round(_num(r[7]) or 0, 2)})
    weighted = {r[0]: round(_num(r[7]) or 0, 2) for r in rows[21:32] if r[0]}
    for s in shops:
        s["weighted_total"] = weighted.get(s["shop"])
    shops.sort(key=lambda s: -(s["weighted_total"] or 0))
    store = next(s for s in shops if s["shop"] == "store.softline.ru")
    rivals = [s for s in shops if s is not store]
    blocks = []
    for b in BLOCKS:
        mine = store["scores"][b]
        known = [(s["shop"], s["scores"][b]) for s in rivals if s["scores"][b] is not None]
        best_shop, best = max(known, key=lambda x: x[1]) if known else (None, None)
        gap = round(mine - best, 1) if mine is not None and best is not None else None
        verdict = ("нет данных" if gap is None else "лидер" if gap > 0 else "на уровне лучших" if gap == 0 else "отстаём")
        blocks.append({"block": b, "weight_pct": weights.get(b), "store": mine, "best_rival": best_shop, "best_score": best,
                       "gap": gap, "verdict": verdict, "rivals_with_data": len(known), "evidence": EVIDENCE.get(b, [])})
    return {"source": "Store_Конкурентное_исследование.xlsx, лист «Итоги»", "scale": "1 — слабо, 3 — средне, 5 — сильно",
            "store_rank": [s["shop"] for s in shops].index("store.softline.ru") + 1, "shops": shops, "blocks": blocks,
            "summary": _summary(blocks, shops)}


def _summary(blocks, shops) -> str:
    lag = [f"{b['block']} ({b['store']:g} против {b['best_score']:g} у {b['best_rival']})" for b in blocks if b["verdict"] == "отстаём"]
    lead = [b["block"] for b in blocks if b["verdict"] in ("лидер", "на уровне лучших")]
    return (f"Store — {[s['shop'] for s in shops].index('store.softline.ru') + 1}-е место из {len(shops)} по взвешенному баллу. "
            f"На уровне лучших или лидер: {', '.join(lead)}. Отстаём: {', '.join(lag) or 'нет'}.")
