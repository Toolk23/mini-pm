import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorBox, Loading, fmtDate, useApi } from '../components/ui'
import { SignalRow, signalTitle, useMetricNames } from '../components/SignalRow'
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

  const names = useMetricNames()
  const titleOf = (id: string) => { const x = signals.data?.find((y) => y.id === id); return x ? signalTitle(x, names) : id }
  const STATUS: Record<string, [string, string]> = { done: ['готово', 'done'], running: ['идёт', 'running'], error: ['ошибка', 'error'] }

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
        <div className="card sig-list" style={{ padding: 6 }}>
          {signals.data?.map((s, i) => (
            <SignalRow key={s.id} s={s} names={names} as="button" onClick={() => !starting && start(s.id)} style={{ ['--i' as string]: i + 1 }}
              action={starting === s.id ? <span className="row faint"><span className="spinner" /> Запускаю…</span> : <span className="btn btn-sm">Расследовать</span>} />
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
                <code className="inv-id">{inv.id}</code>
                <span className="inv-row-title"><Rich text={titleOf(inv.signal_id)} /></span>
                <span className="row" style={{ gap: 12 }}>
                  {inv.applied && <span className="faint">письмо и задача {inv.applied.task.task_id}</span>}
                  <span className={`status status-${cls}`}><i aria-hidden />{label}</span>
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
