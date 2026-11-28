"""Тесты гоняются без LLM и без внешних сервисов: модель, поиск, почта и витрина отключены, состояние — во временной папке."""
import os
import sys
import tempfile
from pathlib import Path

os.environ["LLM_API_KEY"] = ""
os.environ["SEARCH_API_KEY"] = ""
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["METRIKA_TOKEN"] = ""
os.environ["STATE_DIR"] = tempfile.mkdtemp(prefix="minipm-test-")
os.environ["FRONTEND_DIST"] = tempfile.mkdtemp(prefix="minipm-nofront-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    from backend.app import storefront
    # витрину не дёргаем из тестов — берём сохранённый снимок карточки
    monkeypatch.setattr(storefront, "read_card", lambda url: {"ok": False, "url": url, "error": "offline in tests"})


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from backend.app.main import app
    with TestClient(app) as c:
        yield c
