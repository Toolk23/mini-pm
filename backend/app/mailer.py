"""Отправка писем ПМу на тестовую почту (требование заказчика: «хотелось бы увидеть отправку на тестовую учетку»).

SMTP с SSL (465) или STARTTLS (587). По умолчанию — Яндекс Почта: SMTP_USER — ящик, SMTP_PASSWORD — пароль приложения.
Без настроек письмо только сохраняется в outbox/*.eml, как раньше. Ошибка отправки не роняет «Курьера».
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

from . import config, store


def configured() -> bool:
    return bool(config.SMTP_USER and config.SMTP_PASSWORD and config.MAIL_TO)


def build(subject: str, body: str, to: str | None = None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"мини ПМ <{config.MAIL_FROM or 'mini-pm@store.local'}>"
    msg["To"] = to or config.MAIL_TO or "pm@store.local"
    msg["X-Generated-By"] = config.AI_TAG
    msg.set_content(body)
    return msg


def send(subject: str, body: str, to: str | None = None) -> dict:
    """Отправляет письмо. Возвращает {ok, to, at} или {ok: False, error}. Никогда не бросает исключение."""
    if not configured():
        return {"ok": False, "error": "SMTP не настроен (SMTP_USER / SMTP_PASSWORD / MAIL_TO) — письмо сохранено в outbox"}
    msg = build(subject, body, to)
    try:
        ctx = ssl.create_default_context()
        if config.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=ctx, timeout=20) as s:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
    except Exception as e:  # noqa: BLE001 — показываем причину в UI, письмо остаётся в outbox
        return {"ok": False, "to": msg["To"], "error": f"{type(e).__name__}: {e}"[:300]}
    res = {"ok": True, "to": msg["To"], "at": store.now(), "subject": subject}
    log = store.read("mail_log", [])
    log.append(res)
    store.write("mail_log", log[-200:])
    return res
