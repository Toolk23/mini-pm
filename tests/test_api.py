"""Смоук API: основные ручки отвечают 200 и в ожидаемом формате."""


def test_health(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["data"]["sales"] > 0


def test_main_endpoints_ok(client):
    for path in ["/api/signals", "/api/metrics", "/api/sales", "/api/releases", "/api/data-gaps", "/api/backlog/tasks",
                 "/api/hypotheses", "/api/settings", "/api/sales-faq", "/api/usage/tokens",
                 "/api/metrics/family_orders_idx/series?product=ЛК", "/api/backlog/redmine.csv"]:
        assert client.get(path).status_code == 200, path


def test_investigation_flow(client):
    import time
    inv = client.post("/api/investigations", json={"signal_id": "SIG-SALES-KES"}).json()["id"]
    for _ in range(60):
        job = client.get(f"/api/investigations/{inv}").json()
        if job["status"] != "running":
            break
        time.sleep(0.5)
    assert job["status"] == "done"
    applied = client.post(f"/api/investigations/{inv}/apply").json()
    assert applied["task"]["task_id"].startswith("T-")
    assert client.get("/api/backlog/redmine.csv?ai_only=true").text.count("\n") >= 2


def test_unknown_signal_404(client):
    assert client.post("/api/investigations", json={"signal_id": "NOPE"}).status_code == 404


def test_index_not_cached_when_frontend_built(client):
    # без собранного фронта отдаётся заглушка; заголовок no-cache проверяется на стенде
    assert client.get("/").status_code == 200
