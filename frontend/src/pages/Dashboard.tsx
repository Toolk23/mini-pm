import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Signal } from '../api/types'
import { Card, ErrorBox, Loading, PageHead, PriorityBadge, fmtPct, useApi } from '../components/ui'

// Каркас дашборда: KPI главного сигнала + лента. График с аннотациями — блок 2.
export default function Dashboard() {
  const signals = useApi(() => api.signals())
  const main = signals.data?.find((s) => s.kind === 'sales_drop')

  return (
    <>
      <PageHead title="Радар метрик" subtitle="Детектор следит за метриками магазина и поднимает устойчивые отклонения" />

      {signals.loading && <Loading />}
      {signals.error && <ErrorBox error={signals.error} onRetry={signals.reload} />}

      {main?.change && (
        <div className="grid grid-3">
          <Card>
            <div className="stat-label">Заказы {main.family} к базе</div>
            <div className="stat-value down">{fmtPct(main.change.change_pct)}</div>
            <div className="faint">{main.change.baseline_mean} → {main.change.post_mean} · {main.change.post_period}</div>
          </Card>
          <Card>
            <div className="stat-label">Контроль: {main.control?.name}</div>
            <div className="stat-value">{fmtPct(main.control?.change_pct)}</div>
            <div className="faint">{main.control?.conclusion}</div>
          </Card>
          <Card>
            <div className="stat-label">Главный кандидат</div>
            <div className="stat-value">{main.release_candidates?.find((r) => r.release_id === 'R-09')?.release_id ?? main.release_candidates?.[0]?.release_id ?? '—'}</div>
            <div className="faint">окно релизов перед падением</div>
          </Card>
        </div>
      )}

      {signals.data && (
        <Card title="Лента сигналов" extra={<span className="faint">{signals.data.length} активных</span>}>
          <div className="stack">
            {signals.data.map((s) => <SignalRow key={s.id} s={s} />)}
          </div>
        </Card>
      )}
    </>
  )
}

function SignalRow({ s }: { s: Signal }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row"><PriorityBadge p={s.priority} /> <strong>{s.title}</strong></div>
        {s.caveats.length > 0 && <div className="faint">{s.caveats[0]}</div>}
      </div>
      <Link className="btn btn-sm" to={`/investigations?signal=${encodeURIComponent(s.id)}`}>Расследовать</Link>
    </div>
  )
}
