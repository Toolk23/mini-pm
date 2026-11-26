import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorBox, Loading, PriorityBadge, fmtDate, useApi } from '../components/ui'
import { Hl, KIcons, Kicker, Rich, SectionHead } from '../components/highlight'

export default function Investigations() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const signals = useApi(() => api.signals())
  const list = useApi(() => api.investigations())
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async (signalId: string) => {
    setStarting(signalId)
    setError(null)
    try {
      const inv = await api.startInvestigation(signalId)
      nav(`/investigations/${inv.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStarting(null)
    }
  }

  // Пришли с дашборда по кнопке «Расследовать» — сразу запускаем.
  const preselected = params.get('signal')
  const startedFor = useRef<string | null>(null) // StrictMode вызывает эффект дважды — не запускаем два расследования
  useEffect(() => {
    if (preselected && startedFor.current !== preselected) {
      startedFor.current = preselected
      start(preselected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected])

  const titleOf = (id: string) => signals.data?.find((x) => x.id === id)?.title ?? id
  const STATUS: Record<string, [string, string]> = { done: ['готово', 'badge-success'], running: ['идёт', 'badge-high'], error: ['ошибка', 'badge-critical'] }

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="blue" icon={<KIcons.search />}>Следствие</Kicker>}
        title={<>Каждый сигнал — <Hl tone="warm">расследование</Hl></>}
        lead={<>Агент проверяет сигнал по <b>всем источникам</b>: продажи и контроль, релизы, воронка, реестр разрывов, бэклог,
          интервью и конкуренты. Выводы — <b>только по фактам</b>, «нет данных» — честно.</>}
      />
      {error && <ErrorBox error={error} />}

      <section className="stack" style={{ gap: 10 }}>
        <div className="eyebrow">запустить по сигналу</div>
        {signals.loading && <Loading />}
        {signals.error && <ErrorBox error={signals.error} onRetry={signals.reload} />}
        <div className="grid grid-3">
          {signals.data?.map((s, i) => (
            <button key={s.id} className={`signal-item reveal prio-${s.priority.toLowerCase()} start-card`} style={{ ['--i' as string]: i + 1 }}
              disabled={!!starting} onClick={() => start(s.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}><PriorityBadge p={s.priority} /><span className="faint mono">{s.product}</span></div>
              <div className="signal-title"><Rich text={s.title} /></div>
              <span className="signal-cta" style={{ opacity: starting === s.id ? 1 : undefined }}>{starting === s.id ? <><span className="spinner" /> Запускаю…</> : 'Расследовать'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <div className="eyebrow">история · {list.data?.length ?? 0}</div>
        {list.loading && <Loading />}
        {list.data?.length === 0 && <div className="board-empty">Расследований пока нет — выберите сигнал выше</div>}
        <div className="stack" style={{ gap: 8 }}>
          {list.data?.map((inv) => {
            const [label, cls] = STATUS[inv.status] ?? [inv.status, '']
            return (
              <Link key={inv.id} to={`/investigations/${inv.id}`} className="inv-row reveal">
                <code className="tok-id">{inv.id}</code>
                <span className="inv-row-title"><Rich text={titleOf(inv.signal_id)} /></span>
                <span className="row" style={{ gap: 6 }}>
                  {inv.applied && <span className="badge badge-ai">письмо и задача {inv.applied.task.task_id}</span>}
                  <span className={`badge ${cls}`}>{label}</span>
                  <span className="faint">{fmtDate(inv.created_at)} {new Date(inv.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="inv-row-arrow">→</span>
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </>
  )
}
