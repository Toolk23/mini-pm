"""«Курьер»: превращает отчёт расследования в действия — задача, приоритеты, гипотеза, письмо."""
from __future__ import annotations

from . import config, mailer, store


SOURCE_NAMES = {"metrika": "Метрика", "backlog": "Бэклог", "interviews": "Интервью", "competitors": "Конкуренты",
                "web": "Поиск Яндекса", "analyst": "Сводка аналитика"}


def _render_email(rep: dict, task: dict, raised: list[dict]) -> dict:
    ev = rep.get("evidence", {})
    sig = ev.get("signal", {})
    lines = [
        rep.get("email", {}).get("body") or rep.get("summary", ""),
        "",
        "Проверка по источникам:",
        *[f"  • {SOURCE_NAMES.get(k, k)}: {v}" for k, v in (rep.get("sources_check") or {}).items() if k != "comment"],
        "",
        "Гипотезы:",
        *[f"  {i + 1}. {h['text']} — проверка: {h['check']}" for i, h in enumerate(rep.get("hypotheses", []))],
        "",
        "Что я сделал в бэклоге:",
        f"  • Создана задача {task['task_id']} «{task['title']}» [{config.AI_TAG}], приоритет {task['priority']}",
        *[f"  • {r['task_id']}: приоритет → {r['new_priority']} ({r.get('why', '')})" for r in raised],
        "",
        f"Критерий успеха: {rep.get('success_criterion')}",
        f"Правило закрытия: {rep.get('closing_rule')}",
        "",
        "Пробелы в данных:",
        *[f"  • {g['text']}" for g in ev.get("data_gaps", [])],
        "",
        f"— мини ПМ · расследование {rep.get('id')}",
    ]
    subject = rep.get("email", {}).get("subject") or f"[мини ПМ] {sig.get('title', 'Сигнал')}"
    body = "\n".join(lines)
    msg = mailer.build(subject, body)
    path = config.STATE_DIR / "outbox" / f"{rep.get('id')}.eml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(msg))
    # мессенджер заказчика — Dion; в прототипе — мок сообщения в том же формате
    dion = {"channel": "Dion · мини ПМ", "text": f"🔔 {subject}\n{rep.get('summary', '')}\nЗадача: {task['task_id']}"}
    sent = mailer.send(subject, body) if mailer.configured() else {"ok": False, "error": "SMTP не настроен — письмо сохранено в outbox"}
    return {"subject": subject, "body": body, "to": msg["To"], "eml_path": f"outbox/{path.name}", "dion": dion, "sent": sent}


def apply(rep: dict) -> dict:
    t = rep.get("task") or {}
    sig = rep.get("evidence", {}).get("signal", {})
    desc = (t.get("description") or "") + f"\n\nРасследование: {rep.get('id')}. Критерий успеха: {rep.get('success_criterion')}"
    task = store.create_task(t.get("title") or sig.get("title", "Задача от ИИ-помощника"), desc,
                             t.get("priority", "High"), [sig.get("metric_id")] if sig.get("metric_id") else [],
                             investigation_id=rep.get("id"))
    raised = []
    for r in rep.get("raise_tasks") or []:
        try:
            store.update_task(r["task_id"], by="ai", priority=r["new_priority"])
            raised.append(r)
        except KeyError:
            pass
    hs = store.read("hypotheses", [])
    main_h = (rep.get("hypotheses") or [{"text": "Гипотеза расследования"}])[0]
    h = {"id": f"H-{len(hs) + 1:02d}", "status": "open", "created_at": store.now(), "investigation_id": rep.get("id"),
         "text": main_h["text"], "metric_id": sig.get("metric_id", "family_orders_idx"), "family": sig.get("family") or sig.get("product"),
         "control_family": (sig.get("control") or {}).get("family", "Astra"), "target": rep.get("success_criterion"),
         "success_threshold_pct": -10, "task_id": task["task_id"]}
    hs.append(h)
    store.write("hypotheses", hs)
    email = _render_email(rep, task, raised)
    return {"task": task, "raised": raised, "hypothesis": h, "email": email}
