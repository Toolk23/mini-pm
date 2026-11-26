"""Поиск в интернете через Yandex Search API (единственный провайдер, допустимый в контуре заказчика).

POST https://searchapi.api.cloud.yandex.net/v2/web/search, «Authorization: Api-Key <ключ>».
Ответ — JSON с полем rawData (XML в base64). Без ключа модуль честно отвечает «не настроен».
"""
from __future__ import annotations

import base64
import re
import xml.etree.ElementTree as ET

import httpx

from . import config

URL = "https://searchapi.api.cloud.yandex.net/v2/web/search"


def configured() -> bool:
    return bool(config.SEARCH_API_KEY and config.SEARCH_FOLDER_ID)


def _text(el) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def parse_xml(xml: str, k: int) -> list[dict]:
    root = ET.fromstring(xml)
    err = root.find(".//error")
    if err is not None:
        raise RuntimeError(f"Yandex Search: {_text(err)}")
    out = []
    for doc in root.iter("doc"):
        out.append({
            "url": _text(doc.find("url")),
            "domain": _text(doc.find("domain")),
            "title": _text(doc.find("title")),
            "snippet": " … ".join(_text(p) for p in doc.iter("passage"))[:500] or _text(doc.find("headline")),
        })
        if len(out) >= k:
            break
    return out


def search(query: str, k: int = 5) -> dict:
    if not configured():
        return {"ok": False, "query": query, "results": [], "error": "Yandex Search API не настроен (SEARCH_API_KEY / SEARCH_FOLDER_ID)"}
    body = {"query": {"searchType": "SEARCH_TYPE_RU", "queryText": query},
            "folderId": config.SEARCH_FOLDER_ID, "responseFormat": "FORMAT_XML"}
    try:
        r = httpx.post(URL, json=body, headers={"Authorization": f"Api-Key {config.SEARCH_API_KEY}"}, timeout=30)
        r.raise_for_status()
        xml = base64.b64decode(r.json()["rawData"]).decode("utf-8", "replace")
        return {"ok": True, "query": query, "results": parse_xml(xml, k), "source": "Yandex Search API"}
    except Exception as e:  # noqa: BLE001 — поиск не должен ронять расследование
        detail = getattr(getattr(e, "response", None), "text", "")[:200]
        return {"ok": False, "query": query, "results": [], "error": f"{e} {detail}".strip()}
