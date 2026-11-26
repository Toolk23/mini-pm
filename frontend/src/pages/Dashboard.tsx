import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { MetricInfo, Signal } from '../api/types'
import MetricChart, { parsePeriod, type ChartWindow } from '../components/MetricChart'
import MetrikaLivePanel from '../components/MetrikaLivePanel'
import { CountUp, Radar } from '../components/live'
import { Card, ErrorBox, Loading, NoData, NoDataBadge, PriorityBadge, useApi } from '../components/ui'
import { Hl, KIcons, Kicker, Rich, SectionHead } from '../components/highlight'

type Mode = 'sales' | 'metric' | 'live'
const PRODUCTS = ['Конфигуратор Kaspersky', 'Конфигуратор Астра', 'ЛК'] as const

export default function Dashboard() {
  const nav = useNavigate()
  const signals = useApi(() => api.signals())
  const main = signals.data?.find((s) => s.kind === 'sales_drop')

  return (
    <>
      {signals.error && <ErrorBox error={signals.error} onRetry={signals.reload} />}
      {signals.loading && !signals.data && <Loading label="Детектор считает сигналы…" />}

      {main && <Hero s={main} all={signals.data ?? []} onInvestigate={() => nav(`/investigations?signal=${encodeURIComponent(main.id)}`)} />}
      {main && (
        <SectionHead
          kicker={<Kicker tone="teal" icon={<KIcons.pulse />}>Детектор</Kicker>}
          title={<>Не шум, а <Hl tone="teal">тренд</Hl></>}
          lead={<>Статистику считает детерминированный детектор: <b>скользящее за 4 недели</b>, <b>контрольная группа</b>,
            разовые всплески исключены, а пропуски учёта помечены как <b>«нет данных»</b>, а не ноль.</>}
        />
      )}
      {main?.change && <Kpis s={main} />}

      <div className="grid grid-main-side">
        <ChartCard main={main} />
        <SignalFeed signals={signals.data ?? []} loading={signals.loading} />
      </div>
    </>
  )
}

/* ---------------- герой: главный сигнал + радар ---------------- */
function Hero({ s, all, onInvestigate }: { s: Signal; all: Signal[]; onInvestigate: () => void }) {
  const pct = Math.abs(Math.round(s.change?.change_pct ?? 0))
  const ctrl = s.control
  // Короткие пометки — в плашки; длинные методические оговорки остаются в подсказке.
  const chips = s.caveats.filter((c) => /всплеск|неполн/i.test(c))
  return (
    <section className="hero reveal">
      <div className="hero-orbit" aria-hidden><Radar signals={all} size={640} /></div>
      <div className="hero-glow" aria-hidden />

      <button className="pill-warm" onClick={onInvestigate}>
        <span className="live-dot red" /> Критичный сигнал · {s.change?.post_period} <span className="pill-arrow">›</span>
      </button>
      <h1 className="hero-title">
        <span className="grad-silver">Заказы {s.family}</span><br />
        <span className="grad-silver">упали на </span><Hl tone="red">{pct}%</Hl>
      </h1>
      <p className="hero-sub lead">
        Устойчиво — по <b>скользящему среднему</b>, а не по отдельной неделе.
        {ctrl && <> Контроль <b>{ctrl.family} {ctrl.change_pct > 0 ? '+' : ''}{ctrl.change_pct}%</b> — {ctrl.stable ? <>падение <b>специфично для {s.family}</b></> : 'контроль тоже изменился'}.</>}
      </p>
      <div className="row hero-actions">
        <button className="btn btn-primary btn-lg" onClick={onInvestigate}>Запустить расследование</button>
        <Link className="btn btn-lg" to="/story">Вся история →</Link>
      </div>
      {chips.length > 0 && (
        <div className="row hero-chips">
          {chips.map((c) => <span key={c} className="chip" title={c}>{shortCaveat(c)}</span>)}
          <span className="chip" title={s.caveats.filter((c) => !chips.includes(c)).join('\n')}>ещё {s.caveats.length - chips.length} оговорки</span>
        </div>
      )}
    </section>
  )
}

function shortCaveat(c: string) {
  const spike = c.match(/Неделя (\d{2}\.\d{2})\.\d{4}.*всплеск \(([\d.]+)\)/)
  if (spike) return `⚡ ${spike[1]}: всплеск ${Math.round(Number(spike[2]))} исключён`
  if (/неполн/i.test(c)) return '◌ последняя неделя неполная'
  return c.length > 60 ? c.slice(0, 58) + '…' : c
}

/* ---------------- KPI ---------------- */
function Kpis({ s }: { s: Signal }) {
  const ch = s.change!
  const ctrl = s.control
  const top = s.release_candidates?.find((r) => r.release_id === 'R-09') ?? s.release_candidates?.[0]
  return (
    <div className="grid grid-4">
      <Card className="reveal kpi" >
        <div className="stat-label">Заказы {s.family} к базе</div>
        <div className="stat-value down"><CountUp value={ch.change_pct} digits={0} suffix="%" /></div>
        <div className="faint">по среднему за {ch.post_weeks} нед.</div>
      </Card>
      <Card className="reveal kpi">
        <div className="stat-label">Индекс: база → после</div>
        <div className="stat-value"><CountUp value={ch.baseline_mean} /> <span className="arrow">→</span> <CountUp value={ch.post_mean} /></div>
        <div className="faint">{ch.baseline_period} → {ch.post_period}</div>
      </Card>
      <Card className="reveal kpi">
        <div className="stat-label">Контроль · {ctrl?.family}</div>
        <div className="stat-value" style={{ color: 'var(--chart-control)' }}><CountUp value={ctrl?.change_pct ?? 0} digits={0} suffix="%" signed /></div>
        <div className="faint">{ctrl?.stable ? 'стабилен — падение специфично' : 'изменился вместе с продуктом'}</div>
      </Card>
      <Card className="reveal kpi">
        <div className="stat-label">Главный кандидат</div>
        <div className="stat-value">{top?.release_id ?? '—'}</div>
        <div className="faint" title={top?.description}>{top ? `${top.date} · ${top.description.slice(0, 42)}…` : 'релизов в окне нет'}</div>
      </Card>
    </div>
  )
}

/* ---------------- график ---------------- */
function ChartCard({ main }: { main?: Signal }) {
  const [mode, setMode] = useState<Mode>('sales')
  const metrics = useApi(() => api.metrics())
  const [metricId, setMetricId] = useState('cfg_family_views')
  const metric = metrics.data?.find((m) => m.metric_id === metricId)
  const products = productsFor(metricId)
  const [product, setProduct] = useState<string>(products[0])
  const prod = products.includes(product as never) ? product : products[0]

  // Аннотации и разрывы для продаж берём из ряда family_orders_idx.
  const salesMeta = useApi(() => api.series('family_orders_idx', 'Конфигуратор Kaspersky'))
  const metricSeries = useApi(() => (mode === 'metric' ? api.series(metricId, prod) : Promise.resolve(null)), [mode, metricId, prod])

  const windows = useMemo<ChartWindow[]>(() => {
    const b = parsePeriod(main?.change?.baseline_period)
    const p = parsePeriod(main?.change?.post_period)
    return [b && { from: b[0], to: b[1], label: 'база', tone: 'base' as const }, p && { from: p[0], to: p[1], label: 'после релиза', tone: 'post' as const }]
      .filter(Boolean) as ChartWindow[]
  }, [main])

  return (
    <Card className="reveal" title={
      <div className="stack" style={{ gap: 2 }}>
        <h2>{mode === 'sales' ? `Индекс заказов ${main?.family ?? ''} против контроля` : mode === 'metric' ? metric?.metric_name ?? metricId : 'Живой счётчик Яндекс.Метрики'}</h2>
        <span className="faint">{mode === 'sales' ? 'скользящее за 4 недели · релизы · всплески · разрывы учёта' : mode === 'metric' ? metric?.what_it_means : 'запрос к Reporting API на тестовом счётчике команды'}</span>
      </div>
    } extra={
      <div className="segmented">
        <button className={mode === 'sales' ? 'on' : ''} onClick={() => setMode('sales')}>Продажи</button>
        <button className={mode === 'metric' ? 'on' : ''} onClick={() => setMode('metric')}>Метрики</button>
        <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}><span className="live-dot" style={{ marginRight: 6 }} />Live</button>
      </div>
    }>
      {mode === 'metric' && (
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={metricId} onChange={(e) => setMetricId(e.target.value)} aria-label="Метрика">
            {(metrics.data ?? []).filter((m) => m.metric_id !== 'family_orders_idx').map((m: MetricInfo) =>
              <option key={m.metric_id} value={m.metric_id}>{m.metric_name}</option>)}
          </select>
          {products.length > 1 && (
            <div className="segmented">
              {products.map((p) => <button key={p} className={prod === p ? 'on' : ''} onClick={() => setProduct(p)}>{p.replace('Конфигуратор ', '')}</button>)}
            </div>
          )}
        </div>
      )}

      {mode === 'sales' && (main?.series ? (
        <MetricChart name={main.family ?? 'KES'} points={main.series}
          control={main.control_series && main.control ? { points: main.control_series, name: main.control.family } : undefined}
          annotations={salesMeta.data?.annotations} gaps={salesMeta.data?.gaps} windows={windows} highlightRelease="R-09"
          labelReleases={main.release_candidates?.map((r) => r.release_id)} />
      ) : <Loading />)}

      {mode === 'metric' && (
        metricSeries.loading ? <Loading /> :
        metricSeries.error || !metricSeries.data?.points?.length ? (
          <NoData title="Нет данных по этой паре">
            Метрика «{metric?.metric_name ?? metricId}» для «{prod}» не собирается — это пометка, а не ноль.
            {metric?.comment && <div className="faint" style={{ marginTop: 4 }}>{metric.comment}</div>}
          </NoData>
        ) : (
          <MetricChart name={metric?.metric_name ?? metricId} points={metricSeries.data.points}
            annotations={metricSeries.data.annotations} gaps={metricSeries.data.gaps} />
        )
      )}

      {mode === 'live' && <MetrikaLivePanel />}

      {mode !== 'live' && (
        <GapsStrip gaps={(mode === 'sales' ? salesMeta.data?.gaps : metricSeries.data?.gaps) ?? []} />
      )}
    </Card>
  )
}

function productsFor(metricId: string): readonly string[] {
  if (metricId.startsWith('lk_')) return ['ЛК']
  return PRODUCTS.slice(0, 2)
}

function GapsStrip({ gaps }: { gaps: { id: string; text: string }[] }) {
  if (!gaps.length) return null
  return (
    <div className="stack" style={{ marginTop: 14, gap: 6 }}>
      {gaps.map((g) => (
        <div key={g.id} className="row faint" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <NoDataBadge label={g.id} /> <span>{g.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------- лента сигналов ---------------- */
function SignalFeed({ signals, loading }: { signals: Signal[]; loading: boolean }) {
  return (
    <Card className="reveal feed" title={<h2>Лента сигналов</h2>} extra={<span className="row faint"><span className="live-dot" /> {signals.length} активных</span>}>
      {loading && !signals.length && <Loading />}
      <div className="stack" style={{ gap: 8 }}>
        {signals.map((s, i) => (
          <Link key={s.id} to={`/investigations?signal=${encodeURIComponent(s.id)}`} className={`signal-item reveal prio-${s.priority.toLowerCase()}`}
            style={{ ['--i' as string]: i + 2 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <PriorityBadge p={s.priority} />
              <span className="faint mono">{s.product}</span>
            </div>
            <div className="signal-title"><Rich text={s.title} /></div>
            {s.caveats[0] && <div className="faint">{shortCaveat(s.caveats[0])}</div>}
            <span className="signal-cta">Расследовать →</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}
