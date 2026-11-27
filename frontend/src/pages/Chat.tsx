import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import type { ChatMessage, ChatResponse, KnowledgeHit } from '../api/types'
import { Hl, Kicker, KIcons, Rich } from '../components/highlight'
import { ErrorBox, PriorityBadge } from '../components/ui'

// Контрольные вопросы менеджера (план, раздел 3.4) + проверка «нет данных» и поиска в интернете.
// Демо-вопросы из справки аналитика (spravka-prodazhi.md) + проверка «нет данных».
const SUGGESTIONS = [
  'Почему упали заказы Kaspersky?',
  'Мы хуже allsoft по цене на Kaspersky?',
  'Как оформить счёт?',
  'Как выбрать лицензию Kaspersky?',
  'Почему клиенты не покупают на сайте?',
  'Почему клиенты перестали покупать?',
  'Как купить Astra?',
  'Astra дороже allsoft?',
  'Из-за чего срывается покупка?',
  'Сколько стоит Kaspersky на Озоне? — проверка «нет данных»',
]
const THINKING = ['Ищу в интервью и конкурентном анализе…', 'Сверяюсь с сигналами детектора…', 'Проверяю реестр разрывов учёта…', 'Собираю ответ со ссылками…']

interface Turn { role: 'user' | 'assistant'; content: string; res?: ChatResponse; error?: string }
const STORE = 'minipm.chat'

export default function Chat() {
  const loc = useLocation()
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) ?? '[]') } catch { return [] }
  })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30))) } catch { /* ignore */ } }, [turns])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns.length, busy])
  useEffect(() => { inputRef.current?.focus() }, [loc.key])
  useEffect(() => {
    if (!busy) return
    setPhase(0)
    const t = setInterval(() => setPhase((p) => (p + 1) % THINKING.length), 1400)
    return () => clearInterval(t)
  }, [busy])

  // Вопрос, переданный из Ctrl+K / других страниц.
  useEffect(() => {
    const q = (loc.state as { ask?: string } | null)?.ask
    if (q) { ask(q); window.history.replaceState({}, '') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key])

  const ask = async (q: string) => {
    const message = q.replace(/ — проверка «нет данных»$/, '').trim()
    if (!message || busy) return
    const history: ChatMessage[] = turns.filter((t) => !t.error).slice(-8).map((t) => ({ role: t.role, content: t.content }))
    setTurns((p) => [...p, { role: 'user', content: message }])
    setText('')
    setBusy(true)
    try {
      const res = await api.chat(message, history)
      setTurns((p) => [...p, { role: 'assistant', content: res.answer, res }])
    } catch (e) {
      setTurns((p) => [...p, { role: 'assistant', content: '', error: e instanceof Error ? e.message : String(e) }])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const empty = turns.length === 0
  return (
    <div className="chat">
      {empty ? (
        <header className="chat-hero reveal">
          <Kicker tone="violet" icon={<KIcons.search />}>Чат с аватаром ПМа</Kicker>
          <h1 className="hero-title" style={{ fontSize: 'clamp(36px, 5vw, 60px)' }}>
            <span className="grad-silver">Спросите </span><Hl tone="violet">мини ПМ</Hl>
          </h1>
          <p className="hero-sub lead">Отвечает <b>только по данным магазина</b>: метрики, релизы, бэклог, интервью и конкуренты.
            У каждого ответа — <b>источники</b>. Если данных нет, так и скажет: <b>«нет данных»</b>.</p>
          <div className="suggest-grid">
            {SUGGESTIONS.map((s, i) => (
              <button key={s} className="suggest reveal" style={{ ['--i' as string]: i + 2 }} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        </header>
      ) : (
        <div className="chat-log">
          {turns.map((t, i) => t.role === 'user'
            ? <div key={i} className="msg-user reveal"><div className="bubble-user">{t.content}</div></div>
            : <Answer key={i} t={t} onAsk={ask} />)}
          {busy && (
            <div className="msg-ai reveal">
              <span className="ai-avatar thinking">ПМ</span>
              <div className="thinking-line"><span className="dots3"><i /><i /><i /></span>{THINKING[phase]}</div>
            </div>
          )}
          <div ref={endRef} className="chat-end" />
        </div>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        <textarea ref={inputRef} value={text} rows={1} placeholder="Спросите про метрики, релизы, клиентов или конкурентов…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) } }} />
        <div className="composer-bar">
          <span className="row faint" style={{ gap: 6 }}><span className="kbd">Enter</span> отправить <span className="kbd">Shift</span>+<span className="kbd">Enter</span> новая строка</span>
          <span className="row" style={{ gap: 6 }}>
            {!empty && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTurns([])} disabled={busy}>Новый диалог</button>}
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{busy ? <span className="spinner" /> : <>Спросить <span className="kbd">Enter</span></>}</button>
          </span>
        </div>
      </form>
    </div>
  )
}

/* ---------- ответ ассистента ---------- */
function Answer({ t, onAsk }: { t: Turn; onAsk: (q: string) => void }) {
  const [open, setOpen] = useState(false)
  if (t.error) return <div className="msg-ai"><span className="ai-avatar">ПМ</span><ErrorBox error={t.error} /></div>
  const res = t.res!
  const searchOnly = res.mode !== 'llm'
  const noData = /нет данных/i.test(res.answer) && res.sources.length === 0
  return (
    <div className="msg-ai reveal">
      <span className="ai-avatar">ПМ</span>
      <div className="stack" style={{ gap: 10, minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 6 }}>
          <b>мини ПМ</b>
          <span className={`badge ${searchOnly ? '' : 'badge-ai'}`} title={searchOnly ? 'LLM не подключена — показываю найденные фрагменты' : 'Ответ сформулировала модель по найденным фактам'}>
            {searchOnly ? 'поиск по базе' : 'LLM + факты'}
          </span>
        </div>

        {noData ? (
          <div className="nodata"><div className="nodata-title">Нет данных</div>{res.answer}</div>
        ) : searchOnly ? (
          <p className="muted">LLM на этом стенде не подключена, поэтому вместо пересказа — <b>найденные фрагменты</b> с источниками:</p>
        ) : (
          <div className="answer"><Markdownish text={res.answer} /></div>
        )}

        {res.sources.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            {(searchOnly ? res.sources.slice(0, 4) : open ? res.sources : []).map((s, i) => <SourceCard key={s.id + i} s={s} n={i + 1} />)}
            {!searchOnly && (
              <button className="sources-toggle" onClick={() => setOpen((o) => !o)}>
                {open ? 'Скрыть источники' : `Источники · ${res.sources.length}`} <span>{open ? '▴' : '▾'}</span>
              </button>
            )}
          </div>
        )}

        <Facts res={res} onAsk={onAsk} />
      </div>
    </div>
  )
}

/** Лёгкий markdown: абзацы, списки, **жирный**, ссылки на источники [1]. */
function Markdownish({ text }: { text: string }) {
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}><Inline s={l} /></li>)}</ul>); list = [] } }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const li = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/)
    if (li) { list.push(li[1]); continue }
    flush()
    if (!line) continue
    const h = line.match(/^#{1,4}\s+(.*)$/)
    out.push(h ? <h4 key={out.length}>{h[1]}</h4> : <p key={out.length}><Inline s={line} /></p>)
  }
  flush()
  return <>{out}</>
}
function Inline({ s }: { s: string }) {
  const parts = s.split(/(\*\*[^*]+\*\*|\[\d+\])/g)
  return <>{parts.map((p, i) => p.startsWith('**') ? <b key={i}><Rich text={p.slice(2, -2)} /></b>
    : /^\[\d+\]$/.test(p) ? <sup key={i} className="cite">{p.slice(1, -1)}</sup> : <Fragment key={i}><Rich text={p} /></Fragment>)}</>
}

function SourceCard({ s, n }: { s: KnowledgeHit; n: number }) {
  const text = s.text.replace(/^\[[^\]]+\]\s*/, '')
  const label = s.source_type === 'interview' ? 'Интервью' : s.source_type === 'competitor' ? 'Конкуренты' : s.source_type === 'upload' ? 'Загружено' : s.source_type
  return (
    <figure className="quote src-card">
      <div className="row" style={{ justifyContent: 'space-between', marginLeft: 10, marginBottom: 4 }}>
        <span className="row" style={{ gap: 6 }}><span className="cite">{n}</span><span className="badge">{label}</span></span>
        <span className="faint mono">score {s.score.toFixed(1)}</span>
      </div>
      <blockquote>{text.length > 260 ? text.slice(0, 258) + '…' : text}</blockquote>
      <figcaption className="faint mono">{s.file}{s.sheet ? ` · ${s.sheet}` : ''}{s.row ? ` · строка ${s.row}` : ''}</figcaption>
    </figure>
  )
}

/* ---------- «На чём основан ответ» ---------- */
interface DetailedSignal {
  id: string; title: string; priority: string
  change?: { change_pct: number; baseline_mean: number; post_mean: number }
  control?: { family: string; change_pct: number; stable: boolean }
  releases_ranked?: { release_id: string; score: number }[]
}
function Facts({ res, onAsk }: { res: ChatResponse; onAsk: (q: string) => void }) {
  const f = res.facts as (ChatResponse['facts'] & { web?: { ok?: boolean; results?: { url: string; title?: string; domain?: string }[] } }) | undefined
  const detailed = (f?.signals_detailed ?? []) as DetailedSignal[]
  const others = f?.other_signals ?? []
  const web = f?.web?.results ?? []
  if (!detailed.length && !others.length && !web.length) return null
  return (
    <div className="facts">
      <div className="eyebrow">на чём основан ответ</div>
      {detailed.map((s) => {
        const top = s.releases_ranked?.[0]
        return (
          <div key={s.id} className="fact-row">
            <PriorityBadge p={s.priority} />
            <span className="fact-title"><Rich text={s.title} /></span>
            {s.control && <span className="chip">контроль {s.control.family} <Rich text={`${s.control.change_pct > 0 ? '+' : ''}${s.control.change_pct}%`} /></span>}
            {top && <span className="chip">главный кандидат <span className="tok-id hot">{top.release_id}</span> {Math.round(top.score * 100)}%</span>}
          </div>
        )
      })}
      {others.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="faint">ещё сигналы:</span>
          {others.slice(0, 4).map((o) => <button key={o.id} className="chip chip-btn" onClick={() => onAsk(`Расскажи про сигнал «${o.title}»`)}>{o.title}</button>)}
        </div>
      )}
      {web.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="faint">интернет:</span>
          {web.slice(0, 4).map((w) => <a key={w.url} className="chip" href={w.url} target="_blank" rel="noreferrer">{w.domain ?? w.title ?? w.url}</a>)}
        </div>
      )}
    </div>
  )
}
