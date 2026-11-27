"""Справка для отдела продаж: шпаргалка по продукту и ответы на типовые вопросы.

Бизнес-проблема задачи: ПМ тратит 20–60 ч/мес на повторяющиеся объяснения продавцам (презентации новых продуктов,
типовые вопросы, до 50% вопросов повторяются). Агент собирает справку из тех же источников, что и расследование:
конкурентный анализ (цены, поиск, покупка/счёт, сервис, UX), интервью клиентов, проверенная сводка аналитика,
сигналы продаж, релизы и (если настроен) поиск Яндекса. Каждый тезис — со ссылкой на источник; чего нет в данных —
в блоке «не обещать».
"""
from __future__ import annotations

import json
import uuid

from . import config, detector, ingest, llm, store

FAMILIES = {"KES": "Kaspersky Endpoint Security для бизнеса", "Astra": "Astra Linux"}
ALIASES = {"kes": "KES", "kaspersky": "KES", "касперский": "KES", "каспер": "KES", "astra": "Astra", "астра": "Astra"}


def _family(product: str) -> str | None:
    p = product.lower()
    return next((fam for k, fam in ALIASES.items() if k in p), None)


def _search(query: str, k: int, source: str | None) -> list[dict]:
    from .investigator import _search as s
    return s(query, k, source)


def collect_facts(product: str) -> dict:
    fam = _family(product)
    name = FAMILIES.get(fam, product)
    short = name.split()[0]
    from .investigator import _analyst_evidence, _quotes
    analyst = _analyst_evidence(fam) if fam else None
    competitor_q = [f"{short} цена", f"{short} конкуренты поиск", "покупка счёт юрлицо онлайн", "сервис преимущества отсрочка",
                    "личный кабинет документы лицензии", "понятность лицензирования карточка товара"]
    interview_q = [f"{short} лицензия покупка", "почему покупают у Store", "что важно при выборе поставщика",
                   "проблемы при покупке счёт менеджер", "почему ушли к другому поставщику"]
    seen, competitors, interviews = set(), [], []
    for q in competitor_q:
        for h in _search(q, 3, "competitor"):
            if h["id"] not in seen:
                seen.add(h["id"]); competitors.append(h)
    for q in interview_q:
        for h in _search(q, 3, "interview"):
            if h["id"] not in seen:
                seen.add(h["id"]); interviews.append(h)
    signals = [s for s in detector.detect_all() if fam and s.get("family") == fam]
    rel = ingest.releases()
    releases = [{"id": r.release_id, "date": r.release_date.strftime("%Y-%m-%d"), "type": r.release_type,
                 "description": r.description} for r in rel.itertuples()
                if fam and (fam.lower() in str(r.description).lower() or short.lower() in str(r.description).lower()
                            or "конфигуратор" in str(r.description).lower())]
    web = []
    from . import websearch
    if websearch.configured():
        web = websearch.search(f"{name} купить лицензия цена", 4).get("results", [])
    return {
        "product": name, "family": fam,
        "analyst_quotes": _quotes(analyst, "competitor") + _quotes(analyst, "interview"),
        "analyst_verdict": analyst.get("verdict") if analyst else None,
        "competitors": competitors[:14], "interviews": interviews[:12],
        "signals": [{"id": s["id"], "title": s["title"]} for s in signals],
        "releases": releases[:5], "web": web,
    }


SYSTEM = """Ты — «мини ПМ», ИИ-помощник продакт-менеджера интернет-магазина store.softline.ru (B2B-продажа лицензий ПО).
Собери справку для менеджеров по продажам о продукте, чтобы ПМу не объяснять одно и то же каждому продавцу.
Правила:
1. Только факты из переданных данных. Каждый тезис и ответ — со ссылкой на источник: id цитаты аналитика (E-01…),
   id фрагмента базы, id релиза или URL. Без источника тезис не пиши.
2. Цены — только сопоставимые лицензии (тот же SKU и срок); продления и несравнимые позиции не сравнивай.
3. Если данных нет — так и пиши «нет данных», и вынеси это в dont_say (что продавцу нельзя обещать).
4. Язык простой, для продавца: коротко, без внутренней кухни (метрики, индексы, сигналы — только в internal_note).
5. Типовые вопросы бери из интервью клиентов (что спрашивают, что важно, что мешает купить), ответы — из данных.
6. Даты релизов и цифры переписывай из данных дословно, не пересчитывай.
7. message — только для продавцов: аргументы и ссылка на справку, без внутренних метрик и падений продаж.
Верни строго JSON."""

SCHEMA_HINT = """{
 "product": "...",
 "pitch": "2–3 предложения: что это и почему покупать у Store",
 "who_buys": ["кто покупает и зачем (из интервью)"],
 "key_points": [{"text": "аргумент для клиента", "source": "E-01 | id | URL"}],
 "vs_competitors": [{"competitor": "allsoft.ru", "point": "чем Store лучше/хуже", "source": "..."}],
 "faq": [{"q": "типовой вопрос клиента или продавца", "a": "короткий ответ", "source": "..."}],
 "objections": [{"objection": "возражение клиента", "answer": "что ответить", "source": "..."}],
 "dont_say": ["чего нельзя обещать — нет данных или не подтверждено"],
 "internal_note": "для ПМа: что сейчас происходит с продуктом (сигналы, релизы) и что из этого важно продажам",
 "message": "короткое сообщение в канал отдела продаж (Dion), 3–5 строк"
}"""


def _template(f: dict) -> dict:
    """Без LLM: справка из проверенных цитат аналитика и найденных фрагментов."""
    q = f["analyst_quotes"]
    comp = [x for x in q if x["source_type"] == "competitor"]
    intr = [x for x in q if x["source_type"] == "interview"]
    return {
        "product": f["product"],
        "pitch": f"{f['product']} в Store: справка собрана по конкурентному анализу и интервью клиентов "
                 "(режим без LLM — тезисы взяты напрямую из проверенных цитат аналитика).",
        "who_buys": [x["text"] for x in f["interviews"][:3]],
        "key_points": [{"text": x["finding"], "source": x["id"]} for x in intr if x.get("finding")],
        "vs_competitors": [{"competitor": "рынок", "point": x["finding"], "source": x["id"]} for x in comp if x.get("finding")],
        "faq": [{"q": h["title"] or "Фрагмент интервью", "a": h["text"][:300], "source": h["id"]} for h in f["interviews"][:5]],
        "objections": [],
        "dont_say": ["Не сравнивать цены по продлениям и несопоставимым лицензиям"],
        "internal_note": "; ".join(s["title"] for s in f["signals"]) or "Сигналов по продукту нет.",
        "message": f"Коллеги, обновили справку по {f['product']}: аргументы, сравнение с конкурентами и ответы на типовые вопросы.",
    }


def generate(product: str) -> dict:
    facts = collect_facts(product)
    brief_id = "SB-" + uuid.uuid4().hex[:6].upper()
    mode = "llm"
    if llm.available():
        try:
            rep = llm.chat_json(
                [{"role": "system", "content": SYSTEM},
                 {"role": "user", "content": "Данные (JSON):\n" + json.dumps(facts, ensure_ascii=False, default=str)[:24000]
                                             + f"\n\nСформируй справку для отдела продаж в формате:\n{SCHEMA_HINT}"}],
                step="sales_brief", max_tokens=12000, request_id=brief_id)
        except llm.LLMError as e:
            rep, mode = _template(facts), f"template (LLM error: {e})"
    else:
        rep, mode = _template(facts), "template"
    brief = {"id": brief_id, "created_at": store.now(), "mode": mode, "family": facts["family"],
             "tag": config.AI_TAG, **rep, "evidence": facts}
    saved = store.read("sales_briefs", {})
    saved[brief_id] = brief
    store.write("sales_briefs", saved)
    return brief


def list_briefs() -> list[dict]:
    return sorted(({k: v for k, v in b.items() if k != "evidence"} for b in store.read("sales_briefs", {}).values()),
                  key=lambda b: b["created_at"], reverse=True)


def get(brief_id: str) -> dict | None:
    return store.read("sales_briefs", {}).get(brief_id)


def latest_for(family: str) -> dict | None:
    bs = [b for b in store.read("sales_briefs", {}).values() if b.get("family") == family]
    return max(bs, key=lambda b: b["created_at"]) if bs else None
