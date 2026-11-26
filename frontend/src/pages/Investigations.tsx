import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { Card, ErrorBox, Loading, PageHead, PriorityBadge, fmtDate, useApi } from '../components/ui'

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

  return (
    <>
      <PageHead title="Расследования" subtitle="Агент-следователь проверяет сигнал по всем источникам: метрики, релизы, бэклог, интервью, конкуренты" />
      {error && <ErrorBox error={error} />}

      <Card title="Запустить по сигналу">
        {signals.loading && <Loading />}
        {signals.error && <ErrorBox error={signals.error} onRetry={signals.reload} />}
        <div className="stack">
          {signals.data?.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row"><PriorityBadge p={s.priority} /> {s.title}</div>
              <button className="btn btn-sm btn-primary" disabled={!!starting} onClick={() => start(s.id)}>
                {starting === s.id ? <><span className="spinner" /> Запускаю…</> : 'Расследовать'}
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="История">
        {list.loading && <Loading />}
        {list.data?.length === 0 && <div className="empty">Расследований пока нет</div>}
        <div className="stack">
          {list.data?.map((inv) => (
            <Link key={inv.id} to={`/investigations/${inv.id}`} className="row" style={{ justifyContent: 'space-between' }}>
              <span><strong>{inv.id}</strong> · {inv.signal_id}</span>
              <span className="row">
                <span className={`badge ${inv.status === 'done' ? 'badge-success' : inv.status === 'error' ? 'badge-critical' : ''}`}>{inv.status}</span>
                <span className="faint">{fmtDate(inv.created_at)}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  )
}
