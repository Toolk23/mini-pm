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

      <section className="index-block reveal">
        <header className="index-head"><h2>Сигналы</h2><span className="index-sub">выберите, что расследовать</span></header>
        {signals.loading && <Loading />}
        {signals.error && <ErrorBox error={signals.error} onRetry={signals.reload} />}
        <div className="index-list">
          {signals.data?.map((s, i) => (
            <SignalRow key={s.id} s={s} names={names} index={i + 1} as="button" onClick={() => !starting && start(s.id)} style={{ ['--i' as string]: i + 1 }}
              action={starting === s.id ? <span className="index-go"><span className="spinner" /> запускаю…</span> : <span className="index-go">расследовать →</span>} />
          ))}
        </div>
      </section>

      <section className="index-block reveal" style={{ marginTop: 32 }}>
        <header className="index-head"><h2>История</h2><span className="index-sub">{list.data?.length ?? 0} расследований</span></header>
        {list.loading && <Loading />}
        {list.data?.length === 0 && <div className="board-empty">Расследований пока нет — выберите сигнал выше</div>}
        <div className="index-list">
          {list.data?.map((inv) => {
            const [label, cls] = STATUS[inv.status] ?? [inv.status, '']
            return (
              <Link key={inv.id} to={`/investigations/${inv.id}`} className="inv-idx reveal">
                <span className="sig-idx">{inv.id}</span>
                <span className="inv-idx-title"><span><Rich text={titleOf(inv.signal_id)} /></span>
                  {inv.applied && <span className="inv-idx-sub">письмо ПМу · задача {inv.applied.task.task_id}</span>}</span>
                <span className={`sig-tag st-${cls}`}>{label}</span>
                <span className="inv-idx-date">{fmtDate(inv.created_at).slice(0, 5)} {new Date(inv.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} →</span>
              </Link>
            )
          })}
        </div>
        <div className="index-foot"><span className="index-cross">+</span><span className="index-num">{String(list.data?.length ?? 0).padStart(2, '0')}</span></div>
      </section>
    </>
  )
}
