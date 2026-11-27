"""Загрузка датасета Softline (Excel) в pandas. Исходный файл не изменяется."""
from __future__ import annotations

import json
import threading
from functools import lru_cache

import openpyxl  # noqa: F401 — импорт заранее: параллельный ленивый импорт из потоков падал (circular import → 500)
import pandas as pd

from . import config

MISSING = {"", "нет", "нет данных", "не указан", "none", "nan", "н/д"}

# Семейство в листе «Продажи» ↔ продукт в «Метрики_данные»
FAMILY_TO_PRODUCT = {
    "Kaspersky Endpoint Security": "Конфигуратор Kaspersky",
    "Astra Linux Special Edition": "Конфигуратор Астра",
}
FAMILY_SHORT = {"Kaspersky Endpoint Security": "KES", "Astra Linux Special Edition": "Astra"}


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    s = str(v).strip()
    return None if s.lower() in MISSING else s


def split_list(v) -> list[str]:
    s = _clean(v)
    if not s:
        return []
    return [x.strip() for x in s.replace(";", ",").split(",") if x.strip() and x.strip().lower() not in MISSING]


def _read(sheet: str) -> pd.DataFrame:
    df = pd.read_excel(config.DATASET_XLSX, sheet_name=sheet, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(how="all")


@lru_cache(maxsize=1)
def metrics_catalog() -> pd.DataFrame:
    return _read("Метрики_справочник").dropna(subset=["metric_id"])


@lru_cache(maxsize=1)
def metrics_data() -> pd.DataFrame:
    df = _read("Метрики_данные").dropna(subset=["metric_id"])
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["sample_size"] = pd.to_numeric(df["sample_size"], errors="coerce")

    def parse(js):
        try:
            return json.loads(js) if isinstance(js, str) and js.strip().startswith("{") else None
        except json.JSONDecodeError:
            return None

    df["detail"] = df["detail_json"].map(parse)
    df["comment"] = df["comment"].map(_clean)
    return df


@lru_cache(maxsize=1)
def releases() -> pd.DataFrame:
    df = _read("Релизы").dropna(subset=["release_id"])
    df["release_date"] = pd.to_datetime(df["release_date"])
    df["related_task_ids"] = df["related_task_ids"].map(split_list)
    df["affected_metrics"] = df["affected_metrics"].map(split_list)
    return df


@lru_cache(maxsize=1)
def backlog_seed() -> pd.DataFrame:
    df = _read("Бэклог_задачи").dropna(subset=["task_id"])
    for c in ("created_date", "closed_date"):
        df[c] = df[c].map(_clean)
    df["priority"] = df["priority"].map(lambda v: _clean(v) or "Не указан")
    df["release_id"] = df["release_id"].map(split_list)
    df["linked_metric_ids"] = df["linked_metric_ids"].map(split_list)
    df["source"] = df["source"].map(split_list)
    return df


@lru_cache(maxsize=1)
def sales() -> pd.DataFrame:
    df = _read("Продажи").dropna(subset=["week_start"])
    df["week_start"] = pd.to_datetime(df["week_start"])
    df["orders_index"] = pd.to_numeric(df["orders_index"], errors="coerce")
    df["family"] = df["product_family"].map(lambda f: FAMILY_SHORT.get(f, f))
    df["comment"] = df["comment"].map(_clean) if "comment" in df else None
    return df.sort_values(["family", "week_start"]).reset_index(drop=True)


@lru_cache(maxsize=1)
def reference_case() -> dict:
    raw = pd.read_excel(config.DATASET_XLSX, sheet_name="Эталонный_кейс", header=None, dtype=str)
    rows = [[_clean(x) for x in r] for r in raw.itertuples(index=False)]
    title = rows[0][0]
    note = rows[1][0]
    steps, traps, mode = [], [], None
    for r in rows:
        vals = [x for x in r if x]
        if not vals:
            continue
        if vals[0] == "step":
            mode = "steps"
            continue
        if vals[0].startswith("Ловушки"):
            mode = "traps"
            continue
        if mode == "steps" and vals[0].isdigit():
            keys = ["step", "what_agent_sees", "expected_action", "expected_result", "sheets_used"]
            steps.append(dict(zip(keys, (r + [None] * 5)[:5])))
        elif mode == "traps":
            traps.append(vals[0])
    return {"title": title, "note": note, "steps": steps, "traps": traps}


# Реестр разрывов учёта: из README датасета и комментариев справочника.
# Детектор и агент обязаны сверяться с ним: «нет данных» ≠ ноль.
DATA_GAPS = [
    {"id": "G-01", "scope": "family_orders_idx", "until": "2026-05-04",
     "text": "Самостоятельные заказы учитываются с 04.05.2026 — раньше данных о продажах нет."},
    {"id": "G-02", "scope": "cfg_*", "until": "2026-06-04",
     "text": "События конфигураторов переведены на новую схему 04.06.2026 — события раньше этой даты недоступны."},
    {"id": "G-03", "scope": "cfg_add_to_cart_rate:Конфигуратор Астра", "until": "2026-08-24",
     "text": "Клики и добавления в корзину из конфигуратора Астры собираются с 24.08.2026: до этой даты их нет, это не нули."},
    {"id": "G-04", "scope": "visit_metrics", "from": "2026-09-29",
     "text": "29.09–05.10 терялись источники трафика; с 06.10 визитные показатели (отказы, глубина, конверсия визита) "
             "несопоставимы с прошлым периодом. Счётчики событий пригодны."},
    {"id": "G-05", "scope": "lk_home_views", "until": "2026-07-22",
     "text": "Просмотры главной ЛК до 22.07.2026 завышены техническим учётом (≈10 на посетителя против ≈2) — как базу не использовать."},
    {"id": "G-06", "scope": "cfg_add_to_cart_rate:Конфигуратор Kaspersky",
     "text": "У Kaspersky почти не фиксируется добавление в корзину: cfg_add_to_cart_rate по KES не считается (открыта задача T-08). "
             "Вывод «конверсия = 0» делать нельзя."},
    {"id": "G-07", "scope": "lk_reco_*", "until": "2026-10-21",
     "text": "CTR и показы блока рекомендаций ЛК есть только с 21.10.2026; клики — с 06.08.2026."},
    {"id": "G-08", "scope": "cfg_option_share:Конфигуратор Kaspersky", "until": "2026-10-01",
     "text": "Структура выбора опций Kaspersky (cfg_option_share) — только с 01.10.2026."},
    {"id": "G-09", "scope": "family_orders_idx", "last_week": True,
     "text": "Последняя неделя в листе «Продажи» может быть неполной."},
    {"id": "G-10", "scope": "family_orders_idx",
     "text": "Продажи — только самостоятельные заказы; уход клиентов к менеджеру в данных не виден."},
]


_WARM = threading.Lock()


def warmup() -> dict:
    with _WARM:  # первые параллельные запросы после пробуждения стенда не читают Excel наперегонки
        return _warm()


def _warm() -> dict:
    return {
        "metrics_catalog": len(metrics_catalog()),
        "metrics_data": len(metrics_data()),
        "releases": len(releases()),
        "backlog": len(backlog_seed()),
        "sales": len(sales()),
        "reference_steps": len(reference_case()["steps"]),
    }
