"""Живая витрина store.softline.ru: агент читает текущую карточку товара (название, цены, ключевой текст).

Даёт справке для продаж и чату актуальную цену магазина, а не только цифры из конкурентного анализа.
Публичная страница, без входа в ЛК. Ошибки сети не роняют агента.
"""
from __future__ import annotations

import html
import re

import httpx

from . import store

CARDS = {
    "KES": "https://store.softline.ru/kaspersky/kaspersky-endpoint-security-dlya-biznesa-standartnyiy/",
}
_UA = "Mozilla/5.0 (mini-PM prototype; hackathon)"


def _text(raw: str) -> str:
    raw = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", raw)).split())


def text_lower(raw: str) -> str:
    return raw.lower()


def read_card(url: str) -> dict:
    try:
        r = httpx.get(url, headers={"User-Agent": _UA}, timeout=20, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as e:
        return {"ok": False, "url": url, "error": str(e)[:200]}
    raw = r.text
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S)
    title = _text(h1.group(1)) if h1 else ""
    prices = []
    for m in re.finditer(r"([0-9]{1,3}(?:[  ][0-9]{3})+|[0-9]{3,7})\s*(?:&nbsp;)?₽", raw):
        v = int(re.sub(r"\D", "", m.group(1)))
        if v >= 100 and v not in prices:
            prices.append(v)
    excerpt = _text(raw[h1.start():] if h1 else raw)[:1500]  # текст карточки начиная с заголовка товара
    issues = []
    if re.search(r"lorem ipsum", excerpt, re.I):
        issues.append("На карточке под ценой остался текст-заглушка «Lorem ipsum» — видно покупателю")
    if not prices:
        issues.append("На карточке не найдена цена")
    if title and "купить" not in text_lower(raw) and "корзин" not in excerpt.lower():
        issues.append("Нет кнопки покупки в тексте карточки")
    return {"ok": True, "url": str(r.url), "title": title, "prices_rub": prices[:10], "excerpt": excerpt, "issues": issues,
            "fetched_at": store.now(), "source": "store.softline.ru (живая карточка)"}


def card_for(family: str | None) -> dict | None:
    url = CARDS.get(family or "")
    return read_card(url) if url else None
