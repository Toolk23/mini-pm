import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { MetricInfo, Signal } from '../api/types'
import MetricChart, { parsePeriod, type ChartWindow } from '../components/MetricChart'
import MetrikaLivePanel from '../components/MetrikaLivePanel'
import { CountUp, Radar } from '../components/live'
import { Card, ErrorBox, Loading, NoData, NoDataBadge, useApi } from '../components/ui'
import { Hl, KIcons, Kicker, SectionHead } from '../components/highlight'
import { SignalRow, useMetricNames } from '../components/SignalRow'
import StoreCard from '../components/StoreCard'

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
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <SignalFeed signals={signals.data ?? []} loading={signals.loading} />
          <StorefrontPanel />
        </div>
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
    <section className="v2-hero">
      <div className="v2-meta hairline-draw">
        <span className="row" style={{ gap: 10 }}><span className="live-dot red" /> Сигнал [01] · критичный</span>
        <span>{s.change?.post_period?.replace(/\.2026/g, '')}</span>
        <LiveClock />
      </div>

      <div className="v2-hero-grid">
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <h1 className="v2-title" data-depth="14">
            <span className="line-mask"><span style={{ ['--d' as string]: 80 }}>Заказы {s.family}</span></span>
            <span className="line-mask"><span style={{ ['--d' as string]: 200 }}>упали на <span className="v2-red">{pct}%</span></span></span>
          </h1>
          <p className="v2-lead reveal" style={{ ['--i' as string]: 5 }}>
            Устойчиво — по скользящему среднему, а не по отдельной неделе.
            {ctrl && <> Контроль {ctrl.family} {ctrl.change_pct > 0 ? '+' : ''}{ctrl.change_pct}% — {ctrl.stable ? `падение специфично для ${s.family}` : 'контроль тоже изменился'}.</>}
          </p>
          <div className="row reveal" style={{ gap: 10, marginTop: 28, ['--i' as string]: 7 }}>
            <button className="btn btn-primary btn-lg" onClick={onInvestigate}>Запустить расследование</button>
            <Link className="btn btn-lg" to="/story">Вся история</Link>
          </div>
        </div>
        <div className="v2-hero-media reveal" style={{ ['--i' as string]: 3 }} aria-hidden>
          {/* радар «в глубине»: уезжает против курсора и наклоняется в перспективе */}
          <div data-depth="-10"><div data-tilt><Radar signals={all} size={340} /></div></div>
          <span className="v2-media-cap">радар · {all.length} сигнал(а)</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="v2-caveats reveal" style={{ ['--i' as string]: 9 }}>
          <span className="eyebrow">оговорки детектора</span>
          {chips.map((c) => <span key={c} title={c}>{shortCaveat(c)}</span>)}
          <span title={s.caveats.filter((c) => !chips.includes(c)).join('\n')}>+ ещё {s.caveats.length - chips.length}</span>
        </div>
      )}
    </section>
  )
}

/** Живые часы МСК — как UTC-часы на HackFirst: показывают, что система «в эфире». */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return <span className="mono">МСК {now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
}

function shortCaveat(c: string) {
  const spike = c.match(/Неделя (\d{2}\.\d{2})\.\d{4}.*всплеск \(([\d.]+)\)/)
  if (spike) return `${spike[1]} — всплеск ${Math.round(Number(spike[2]))} исключён`
  if (/неполн/i.test(c)) return 'последняя неделя неполная'
  return c.length > 60 ? c.slice(0, 58) + '…' : c
}

/* ---------------- KPI ---------------- */
function Kpis({ s }: { s: Signal }) {
  const ch = s.change!
  const ctrl = s.control
  const top = s.release_candidates?.find((r) => r.release_id === 'R-09') ?? s.release_candidates?.[0]
  // Строки как у HackFirst: [номер] · огромная тонкая цифра · подпись моноширинным капсом.
  const rows = [
    { n: '00-01', value: <span className="v2-red"><CountUp value={ch.change_pct} digits={0} suffix="%" /></span>, label: `Заказы ${s.family} к базе`, sub: `по среднему за ${ch.post_weeks} нед.` },
    { n: '00-02', value: <><CountUp value={ch.baseline_mean} /> <span className="v2-arrow">→</span> <CountUp value={ch.post_mean} /></>, label: 'Индекс: база → после', sub: `${ch.baseline_period.replace(/\.2026/g, '')} → ${ch.post_period.replace(/\.2026/g, '')}` },
    { n: '00-03', value: <CountUp value={ctrl?.change_pct ?? 0} digits={0} suffix="%" signed />, label: `Контроль · ${ctrl?.family ?? ''}`, sub: ctrl?.stable ? 'стабилен — падение специфично' : 'изменился вместе с продуктом' },
    { n: '00-04', value: <>{top?.release_id ?? '—'}</>, label: 'Главный кандидат', sub: top ? `${top.date} · ${top.description.slice(0, 48)}…` : 'релизов в окне нет' },
  ]
  return (
    <div className="v2-rows">
      {rows.map((r, i) => (
        <div key={r.n} className="v2-row hairline-draw" style={{ ['--d' as string]: 150 + i * 120 }}>
          <span className="v2-row-n">шаг<br />[{r.n}]</span>
          <span className="v2-row-value reveal" style={{ ['--i' as string]: i + 2 }}>{r.value}</span>
          <span className="v2-row-label">{r.label}<br /><span>{r.sub}</span></span>
        </div>
      ))}
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
  const nav = useNavigate()
  const names = useMetricNames()
  return (
    <section className="index-block reveal">
      <header className="index-head">
        <h2>Сигналы</h2>
        <span className="index-sub"><span className="live-dot" /> {signals.length} активных · live</span>
      </header>
      {loading && !signals.length && <Loading />}
      <div className="index-list">
        {signals.map((s, i) => (
          <SignalRow key={s.id} s={s} names={names} index={i + 1} as="a" href={`/investigations?signal=${encodeURIComponent(s.id)}`}
            onClick={() => nav(`/investigations?signal=${encodeURIComponent(s.id)}`)} style={{ ['--i' as string]: i + 2 }}
            action={<span className="index-go">расследовать →</span>} />
        ))}
      </div>
      <div className="index-foot"><span className="index-cross">+</span><span className="index-num">{String(signals.length).padStart(2, '0')}</span></div>
    </section>
  )
}

/* ---------------- живая витрина ---------------- */
function StorefrontPanel() {
  const card = useApi(() => api.storefrontCard('KES'))
  return (
    <section className="index-block reveal">
      <header className="index-head">
        <h2>Витрина</h2>
        <span className="index-sub"><span className="live-dot" /> живая карточка</span>
      </header>
      {card.loading && !card.data && <Loading label="Открываю store.softline.ru…" />}
      {card.error && <ErrorBox error={card.error} onRetry={card.reload} />}
      {card.data && <StoreCard card={card.data} />}
    </section>
  )
}
