"""Снимает реальные ответы локального бэкенда в фикстуры моков фронтенда.

Запуск (бэкенд уже поднят на :8000):
    python frontend/scripts/dump_mocks.py [http://127.0.0.1:8000]

Внимание: скрипт вызывает POST /investigations, /apply и /measure — это меняет состояние
бэкенда (data/state). Запускать на локальной копии, не на стенде.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/") + "/api"
OUT = Path(__file__).resolve().parents[1] / "src" / "mocks" / "data"
OUT.mkdir(parents=True, exist_ok=True)


def call(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def save(name: str, obj):
    (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    print("ok", name)


for name, path in [("health", "/health"), ("metrics", "/metrics"), ("signals", "/signals"),
                   ("releases", "/releases"), ("data-gaps", "/data-gaps"), ("sales", "/sales"),
                   ("settings", "/settings"), ("metrika-live", "/metrika/live")]:
    save(name, call("GET", path))

# Ряды для дашборда: все метрики справочника × три продукта.
series = {}
for m in call("GET", "/metrics"):
    for product in ["Конфигуратор Kaspersky", "Конфигуратор Астра", "ЛК"]:
        try:
            s = call("GET", f"/metrics/{m['metric_id']}/series?product={urllib.parse.quote(product)}")
        except Exception as e:  # noqa: BLE001
            print("skip", m["metric_id"], product, e)
            continue
        if s.get("points"):
            series[f"{m['metric_id']}|{product}"] = s
save("series", series)

save("search", call("GET", "/knowledge/search?" + urllib.parse.urlencode({"q": "Kaspersky лицензия подбор", "k": 8})))
save("chat", call("POST", "/chat", {"message": "Почему упали заказы Kaspersky?", "history": []}))

save("backlog", call("GET", "/backlog/tasks"))  # исходный бэклог — до apply

# Полный цикл: расследование → apply → два замера.
job =call("POST", "/investigations", {"signal_id": "SIG-SALES-KES"})
while job["status"] == "running":
    time.sleep(2)
    job = call("GET", f"/investigations/{job['id']}")
job.pop("applied", None)
save("investigation", job)
applied = call("POST", f"/investigations/{job['id']}/apply")
save("apply", applied)
save("redmine", call("GET", f"/backlog/tasks/{applied['task']['task_id']}/redmine"))
hid = applied["hypothesis"]["id"]
save("measure-not-recovered", call("POST", f"/hypotheses/{hid}/measure", {"scenario": "not_recovered"}))
save("measure-recovered", call("POST", f"/hypotheses/{hid}/measure", {"scenario": "recovered"}))
print("done:", OUT)
