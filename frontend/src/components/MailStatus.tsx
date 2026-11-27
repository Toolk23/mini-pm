import { useState } from 'react'
import { api } from '../api/client'
import type { MailSent } from '../api/types'

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

/** Ответ почты как есть: «Отправлено на …» или «Не отправлено: …». */
export function MailStatus({ r }: { r: MailSent }) {
  return r.ok
    ? <span className="status status-done"><i aria-hidden />Отправлено на {r.to}{r.at ? ` · ${fmt(r.at)}` : ''}</span>
    : <span className="status status-error"><i aria-hidden />Не отправлено: {r.error ?? 'нет ответа почты'}</span>
}

/** Статус письма ПМу по расследованию + «Отправить ещё раз» (POST /investigations/{id}/send-email). */
export function MailStatusLine({ invId, initial }: { invId: string; initial?: MailSent }) {
  const [r, setR] = useState<MailSent | undefined>(initial)
  const [busy, setBusy] = useState(false)
  const resend = async () => {
    setBusy(true)
    try { setR(await api.resendEmail(invId)) } catch (e) { setR({ ok: false, error: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }
  return (
    <span className="row" style={{ gap: 10 }}>
      {r ? <MailStatus r={r} /> : <span className="faint">статус отправки неизвестен</span>}
      <button className="btn btn-sm btn-ghost" onClick={resend} disabled={busy}>{busy ? <><span className="spinner" /> Отправляю…</> : 'Отправить ещё раз'}</button>
    </span>
  )
}
