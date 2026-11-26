"""Тонкий слой над любым OpenAI-совместимым API (YandexGPT, DeepSeek, OpenAI).

Модель, адрес и ключ — только в .env. Каждый вызов логирует токены по шагу агента (для калькулятора стоимости).
"""
from __future__ import annotations

import json
import re

import httpx

from . import config, store


class LLMError(RuntimeError):
    pass


def available() -> bool:
    return bool(config.LLM_API_KEY)


def chat(messages: list[dict], step: str, *, temperature: float = 0.2, max_tokens: int = 2000,
         json_mode: bool = False, request_id: str | None = None) -> str:
    if not available():
        raise LLMError("LLM_API_KEY не задан — работаем в режиме без модели")
    headers = {"Authorization": f"Bearer {config.LLM_API_KEY}"}
    if config.LLM_FOLDER_ID:
        headers["OpenAI-Project"] = config.LLM_FOLDER_ID  # YandexGPT: каталог
    model = config.model_for(step)
    body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if config.LLM_REASONING_EFFORT:
        body["reasoning_effort"] = config.LLM_REASONING_EFFORT
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    url = config.LLM_BASE_URL.rstrip("/") + "/chat/completions"
    try:
        r = httpx.post(url, headers=headers, json=body, timeout=config.LLM_TIMEOUT)
        if r.status_code == 400 and json_mode:  # не все провайдеры поддерживают response_format
            body.pop("response_format")
            r = httpx.post(url, headers=headers, json=body, timeout=config.LLM_TIMEOUT)
        r.raise_for_status()
    except httpx.HTTPError as e:
        detail = getattr(getattr(e, "response", None), "text", "")[:300]
        raise LLMError(f"Ошибка LLM: {e} {detail}") from e
    data = r.json()
    usage = data.get("usage") or {}
    store.log_tokens(step, model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), request_id)
    choice = data["choices"][0]
    content = choice["message"].get("content") or ""
    if not content.strip():
        raise LLMError(f"Пустой ответ модели (finish_reason={choice.get('finish_reason')}): "
                       "вероятно, не хватило max_tokens на размышления")
    return content


def chat_json(messages: list[dict], step: str, **kw) -> dict:
    text = chat(messages, step, json_mode=True, **kw)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise LLMError(f"Модель вернула не JSON: {text[:200]}")
    raw = m.group(0)
    for candidate in (raw, _relax(raw)):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    raise LLMError("Модель вернула некорректный JSON")


def _relax(s: str) -> str:
    """Чинит типовые огрехи моделей: // комментарии вне строк и висячие запятые."""
    out, i, in_str = [], 0, False
    while i < len(s):
        ch = s[i]
        if in_str:
            out.append(ch)
            if ch == "\\":
                out.append(s[i + 1: i + 2])
                i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            out.append(ch)
        elif s.startswith("//", i):
            while i < len(s) and s[i] != "\n":
                i += 1
            continue
        else:
            out.append(ch)
        i += 1
    return re.sub(r",\s*([}\]])", r"\1", "".join(out))
