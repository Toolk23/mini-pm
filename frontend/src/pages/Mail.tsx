import { Fragment, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ApplyResult, Investigation } from '../api/types'
import { Hl, KIcons, Kicker, Rich, SectionHead } from '../components/highlight'
import { AiBadge, Card, ErrorBox, Loading, useApi } from '../components/ui'

const FROM = 'мини ПМ <mini-pm@store.local>'
const TO = 'Продакт-менеджер <pm@store.local>'

export default function Mail() {
  const { id } = useParams()
  const nav = useNavigate()
  const list = useApi(() => api.investigations())
  const sent = (list.data ?? []).filter((i) => i.applied)
  const currentId = id ?? sent[0]?.id
  // Список отдаёт applied; если письмо открыто по ссылке до обновления списка — дочитываем расследование.
  const one = useApi(() => (currentId ? api.investigation(currentId) : Promise.resolve(null)), [currentId])
  const current = one.data ?? sent.find((i) => i.id === currentId) ?? null

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="warm" icon={<KIcons.send />}>Курьер</Kicker>}
        title={<>Письмо уже <Hl tone="warm">у ПМа</Hl></>}
        lead={<>После расследования «мини ПМ» сам пишет продакту: <b>что случилось</b>, <b>чем подтверждено</b>,
          <b> что уже сделано в бэклоге</b> и <b>как поймём, что помогло</b>. Дублирует коротко в <b>Dion</b>.</>}
      />

      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}

      {list.data && sent.length === 0 && !id && (
        <Card className="reveal">
          <div className="empty stack" style={{ alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 15 }}>Писем пока нет — их отправляет расследование кнопкой «Отправить ПМу».</div>
            <Link className="btn btn-primary" to="/investigations?signal=SIG-SALES-KES">Расследовать падение KES</Link>
          </div>
        </Card>
      )}

      {current?.applied && (
        <div className="mail-layout">
          <aside className="mail-list reveal">
            <div className="eyebrow" style={{ padding: '4px 6px 8px' }}>Отправленные · {sent.length}</div>
            {(sent.length ? sent : [current]).map((i) => (
              <button key={i.id} className={`mail-item${i.id === current.id ? ' on' : ''}`} onClick={() => nav(`/mail/${i.id}`)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>Продакт-менеджер</b><span className="faint">{time(i.created_at)}</span>
                </div>
                <div className="mail-item-subj">{i.applied!.email.subject.replace('[мини ПМ] ', '')}</div>
                <div className="faint mono">{i.id} · {i.applied!.task.task_id}</div>
              </button>
            ))}
          </aside>
          <div className="stack" style={{ gap: 20, minWidth: 0 }}>
            <EmailWindow inv={current} a={current.applied} />
            <DionMessage inv={current} a={current.applied} />
          </div>
        </div>
      )}
      {id && one.data && !one.data.applied && (
        <Card><div className="empty">По расследованию {id} письмо ещё не отправлено. <Link to={`/investigations/${id}`}>Открыть отчёт</Link></div></Card>
      )}
    </>
  )
}

function time(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/* ---------- окно почтового клиента ---------- */
function EmailWindow({ inv, a }: { inv: Investigation; a: ApplyResult }) {
  const hot = (a.email.body.match(/Главный кандидат: (R-\d{2})/) ?? [])[1]
  const download = () => {
    const eml = [`From: ${FROM}`, `To: ${TO}`, `Subject: ${a.email.subject}`, `Date: ${new Date(inv.created_at).toUTCString()}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', a.email.body].join('\r\n')
    const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }))
    const el = document.createElement('a')
    el.href = url
    el.download = `${inv.id}.eml`
    el.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="mail-window reveal glow-behind" style={{ ['--gb' as string]: 'rgba(255, 170, 60, .22)' }}>
      <div className="window-bar">
        <span className="dots"><i /><i /><i /></span>
        <span className="faint">Входящие — Почта</span>
        <button className="btn btn-sm btn-ghost" onClick={download} title="Скачать письмо как .eml">Скачать .eml</button>
      </div>
      <div className="mail-head">
        <div className="mail-avatar">ПМ</div>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>мини ПМ</b><span className="faint">{time(inv.created_at)}</span>
          </div>
          <div className="faint">кому: {TO}</div>
        </div>
      </div>
      <h2 className="mail-subject"><Rich text={a.email.subject} /></h2>
      <div className="mail-body"><EmailBody text={a.email.body} hot={hot ? [hot] : []} /></div>
      <div className="mail-actions">
        <Link className="btn btn-primary" to={`/investigations/${inv.id}`}>Открыть отчёт</Link>
        <Link className="btn btn-ghost" to="/backlog">Задача {a.task.task_id} в бэклоге</Link>
        <AiBadge />
      </div>
    </section>
  )
}

/** Текст письма → разделы, списки, «Ключ: значение»; везде автоподсветка R-xx / T-xx / процентов. */
function EmailBody({ text, hot }: { text: string; hot: string[] }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={blocks.length} className="mail-list-ul">{list.items.map((t, i) => <li key={i}><Rich text={t} hot={hot} /></li>)}</L>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s+•\s+(.*)$/)
    const num = line.match(/^\s+\d+\.\s+(.*)$/)
    if (bullet || num) {
      const ordered = !!num
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((bullet ?? num)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    if (/^[^\s].{0,40}:$/.test(line)) { blocks.push(<h4 key={blocks.length} className="mail-h">{line.slice(0, -1)}</h4>); continue }
    if (line.startsWith('— ')) { blocks.push(<p key={blocks.length} className="mail-sign">{line}</p>); continue }
    const kv = line.match(/^([А-ЯЁA-Z][^:]{1,30}):\s(.*)$/)
    if (kv) { blocks.push(<p key={blocks.length}><b className="mail-key">{kv[1]}:</b> <Rich text={kv[2]} hot={hot} /></p>); continue }
    blocks.push(<p key={blocks.length}><Rich text={line} hot={hot} /></p>)
  }
  flush()
  return <>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</>
}

/* ---------- сообщение в Dion (мок мессенджера заказчика) ---------- */
function DionMessage({ inv, a }: { inv: Investigation; a: ApplyResult }) {
  if (!a.email.dion) return null
  const [first, ...rest] = a.email.dion.text.split('\n')
  return (
    <section className="dion reveal">
      <div className="dion-bar">
        <span className="dion-logo">D</span>
        <b># {a.email.dion.channel.replace(/^Dion · /, '')}</b>
        <span className="faint">Dion · мок мессенджера</span>
      </div>
      <div className="dion-msg">
        <div className="mail-avatar sm">ПМ</div>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="row"><b>мини ПМ</b><span className="badge badge-ai" style={{ height: 18 }}>бот</span><span className="faint">{time(inv.created_at)}</span></div>
          <div className="dion-bubble">
            <div className="dion-title"><Rich text={first} /></div>
            {rest.map((l, i) => <div key={i}><Rich text={l} /></div>)}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Link className="dion-btn" to={`/investigations/${inv.id}`}>Открыть отчёт</Link>
            <Link className="dion-btn" to="/backlog">Задача {a.task.task_id}</Link>
            <span className="dion-react">👀 1</span>
          </div>
        </div>
      </div>
    </section>
  )
}
