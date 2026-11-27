"""Простое файловое хранилище состояния: бэклог, гипотезы, расследования, лог токенов.

JSON-файлы в data/state/. Для прототипа этого достаточно; в пилоте — Postgres.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime

from . import config, ingest

_LOCK = threading.Lock()


def _path(name: str):
    return config.STATE_DIR / f"{name}.json"


def read(name: str, default):
    p = _path(name)
    with _LOCK:
        if p.exists():
            return json.loads(p.read_text("utf-8"))
    return default


def _jsonsafe(x):
    if isinstance(x, float) and x != x:  # NaN → null
        return None
    if isinstance(x, dict):
        return {k: _jsonsafe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonsafe(v) for v in x]
    return x


def write(name: str, data) -> None:
    data = _jsonsafe(data)
    p = _path(name)
    with _LOCK:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), "utf-8")
        tmp.replace(p)


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ------------------------------------------------------------------ бэклог
def backlog() -> list[dict]:
    tasks = read("backlog", None)
    if tasks is None:
        c = ingest._clean
        tasks = [
            {
                "task_id": r.task_id, "title": c(r.title), "type": c(r.type), "status": c(r.status), "priority": r.priority,
                "created_date": r.created_date, "closed_date": r.closed_date, "release_id": r.release_id,
                "description": c(r.description_short), "linked_metric_ids": r.linked_metric_ids, "source": r.source,
                "tags": [], "history": [],
            }
            for r in ingest.backlog_seed().itertuples()
        ]
        write("backlog", tasks)
        tasks = read("backlog", [])
    return tasks


def create_task(title: str, description: str, priority: str = "High", linked_metric_ids=None,
                task_type: str = "Улучшение", investigation_id: str | None = None) -> dict:
    tasks = backlog()
    n = max(int(t["task_id"].split("-")[1]) for t in tasks if t["task_id"].startswith("T-")) + 1
    task = {
        "task_id": f"T-{n:02d}", "title": title, "type": task_type, "status": "New", "priority": priority,
        "created_date": now()[:10], "closed_date": None, "release_id": [], "description": description,
        "linked_metric_ids": linked_metric_ids or [], "source": ["ИИ-помощник"],
        "tags": [config.AI_TAG],  # тег ставит сервер принудительно
        "investigation_id": investigation_id, "history": [{"at": now(), "event": "created"}],
    }
    tasks.append(task)
    write("backlog", tasks)
    return task


def update_task(task_id: str, by: str = "pm", **changes) -> dict:
    """by="ai" — изменение от агента (тег «изменена ИИ-помощником»); by="pm" — человек двигает карточку, тег не ставится."""
    tasks = backlog()
    for t in tasks:
        if t["task_id"] == task_id:
            for k, v in changes.items():
                if v is not None:
                    t["history"].append({"at": now(), "event": f"{k}: {t.get(k)} → {v}", "by": by})
                    t[k] = v
            if by == "ai" and config.AI_TAG not in t["tags"] and "изменена ИИ-помощником" not in t["tags"] \
                    and any(v is not None for v in changes.values()):
                t["tags"].append("изменена ИИ-помощником")
            write("backlog", tasks)
            return t
    raise KeyError(task_id)


def redmine_export(task: dict) -> dict:
    """Задача в формате Redmine REST API (POST /issues.json)."""
    prio = {"Low": 1, "Medium": 2, "Не указан": 2, "High": 3, "Critical": 4}.get(task["priority"], 2)
    return {
        "issue": {
            "project_id": "store-softline",
            "subject": task["title"],
            "description": task["description"],
            "priority_id": prio,
            "tracker_id": 2,  # Feature
            "custom_fields": [{"name": "Источник", "value": "сгенерирована ИИ-помощником"}],
            "tag_list": task.get("tags", []),
        }
    }


def redmine_csv(tasks: list[dict]) -> str:
    """Бэклог в CSV для импорта в Redmine (Задачи → Импорт)."""
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Трекер", "Тема", "Описание", "Приоритет", "Статус", "Метки", "Источник"])
    for t in tasks:
        w.writerow(["Feature" if t.get("type") != "Баг" else "Bug", t["title"], t.get("description", ""),
                    t.get("priority", ""), t.get("status", ""), ", ".join(t.get("tags", [])),
                    "сгенерирована ИИ-помощником" if config.AI_TAG in t.get("tags", []) else "ПМ"])
    return buf.getvalue()


# ------------------------------------------------------------------ лог токенов (для калькулятора)
def log_tokens(step: str, model: str, prompt_tokens: int, completion_tokens: int, request_id: str | None = None):
    log = read("token_log", [])
    log.append({"at": now(), "step": step, "model": model, "in": prompt_tokens, "out": completion_tokens,
                "request_id": request_id})
    write("token_log", log[-2000:])


def token_summary() -> dict:
    log = read("token_log", [])
    by = {}
    for e in log:
        s = by.setdefault(e["step"], {"calls": 0, "in": 0, "out": 0, "model": e["model"]})
        s["calls"] += 1
        s["in"] += e["in"]
        s["out"] += e["out"]
    for s in by.values():
        s["avg_in"] = round(s["in"] / s["calls"])
        s["avg_out"] = round(s["out"] / s["calls"])
    return {"steps": by, "records": len(log)}
