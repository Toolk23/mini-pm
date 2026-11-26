"""Настройки приложения. Всё, что зависит от окружения, — через переменные окружения / .env."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
DATASET_XLSX = RAW_DIR / "dataset.xlsx"
PROCESSED_DIR = DATA_DIR / "processed"
STATE_DIR = Path(os.getenv("STATE_DIR", DATA_DIR / "state"))  # бэклог, настройки, гипотезы, лог токенов
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", ROOT / "frontend" / "dist"))

# LLM: любой OpenAI-совместимый провайдер (YandexGPT, DeepSeek, OpenAI) — меняется только .env
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "deepseek")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-flash")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "180"))
# Для моделей с «размышлениями» (DeepSeek V4): low | high | max. Пусто — параметр не отправляется.
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "")


def model_for(step: str) -> str:
    """Своя модель на каждый шаг агента: LLM_MODEL_INVESTIGATION, LLM_MODEL_CHAT, ...
    Например, расследование — сильная модель, чат — быстрая и дешёвая. По умолчанию — LLM_MODEL."""
    return os.getenv(f"LLM_MODEL_{step.upper()}", LLM_MODEL)


# Для YandexGPT нужен заголовок с каталогом
LLM_FOLDER_ID = os.getenv("LLM_FOLDER_ID", "")

# Яндекс.Метрика (свой тестовый счётчик команды)
METRIKA_TOKEN = os.getenv("METRIKA_TOKEN", "")
METRIKA_COUNTER_ID = os.getenv("METRIKA_COUNTER_ID", "")

AI_TAG = "сгенерирована ИИ-помощником"
