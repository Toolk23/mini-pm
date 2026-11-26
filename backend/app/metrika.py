"""Коннектор Яндекс.Метрики (Reporting API).

Организаторы не выдают счётчик: показываем живой запрос к тестовому счётчику команды,
а анализ кейса Softline делаем на Excel-датасете. Ответ нормализуется в формат наших рядов.
"""
from __future__ import annotations

import httpx

from . import config

API = "https://api-metrika.yandex.net/stat/v1/data"


def configured() -> bool:
    return bool(config.METRIKA_TOKEN and config.METRIKA_COUNTER_ID)


def fetch(date1: str = "7daysAgo", date2: str = "today", metrics: str = "ym:s:visits,ym:s:users",
          dimensions: str = "ym:s:date", goal_id: str | None = None) -> dict:
    if not configured():
        return {"ok": False, "error": "METRIKA_TOKEN / METRIKA_COUNTER_ID не заданы", "source": "metrika"}
    params = {"ids": config.METRIKA_COUNTER_ID, "metrics": metrics, "dimensions": dimensions,
              "date1": date1, "date2": date2, "sort": "ym:s:date", "accuracy": "full", "limit": 1000}
    if goal_id:
        params["metrics"] += f",ym:s:goal{goal_id}reaches"
    r = httpx.get(API, params=params, headers={"Authorization": f"OAuth {config.METRIKA_TOKEN}"}, timeout=30)
    if r.status_code != 200:
        return {"ok": False, "status": r.status_code, "error": r.text[:500], "request": {"url": API, "params": params}}
    data = r.json()
    names = [m.split(":")[-1] for m in data.get("query", {}).get("metrics", [])]
    rows = []
    for row in data.get("data", []):
        rec = {"date": row["dimensions"][0].get("name")}
        rec.update(dict(zip(names, row["metrics"])))
        rows.append(rec)
    return {"ok": True, "source": "metrika", "counter_id": config.METRIKA_COUNTER_ID,
            "request": {"url": API, "params": {k: v for k, v in params.items()}},
            "totals": dict(zip(names, data.get("totals", []))), "rows": rows}
