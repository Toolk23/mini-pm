import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { MetricInfo, MetricRule, Settings, Signal } from '../api/types'
import { Hl, Kicker, SectionHead } from '../components/highlight'
import { SignalRow, signalTitle, useMetricNames } from '../components/SignalRow'
import { CountUp } from '../components/live'
import { ErrorBox, Icons, Loading, useApi } from '../components/ui'

const RULES: Record<string, { label: string; unit: string; min: number; max: number; step: number; hint: (t: number) => string }> = {
  pct_drop: { label: 'Падение', unit: '%', min: 5, max: 80, step: 1, hint: (t) => `сигнал, если метрика упала больше чем на ${t}%` },
  pp_drop: { label: 'Падение', unit: 'п.п.', min: 1, max: 30, step: 0.5, hint: (t) => `сигнал, если доля упала больше чем на ${t} п.п.` },
  pct_rise: { label: 'Рост', unit: '%', min: 5, max: 150, step: 1, hint: (t) => `сигнал, если метрика выросла больше чем на ${t}%` },
  zero_week: { label: 'Недели без событий', unit: '', min: 0, max: 0, step: 1, hint: () => 'сигнал, если есть недели с нулём событий' },
}
const DETECTOR: Record<string, { label: string; unit?: string; step?: number }> = {
  rolling_window_weeks: { label: 'Окно скользящего среднего', unit: 'нед.' },
  baseline_weeks: { label: 'База до падения', unit: 'нед.' },
  min_post_weeks: { label: 'Минимум недель после', unit: 'нед.' },
  spike_ratio: { label: 'Разовый всплеск, если выше медианы в', unit: 'раза', step: 0.05 },
  release_window_days: { label: 'Окно поиска релизов', unit: 'дн.' },
  control_max_change_pct: { label: 'Контроль «стабилен», если меняется не больше', unit: '%' },
}
const SOURCES: Record<string, string> = { metrika: 'Метрика и продажи', backlog: 'Бэклог', interviews: 'Интервью', competitors: 'Конкуренты' }

export default function SettingsPage() {
  const settings = useApi(() => api.settings())
  const metrics = useApi(() => api.metrics())
  const signals = useApi(() => api.signals())
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [prev, setPrev] = useState<Signal[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const names = useMemo(() => Object.fromEntries((metrics.data ?? []).map((m) => [m.metric_id, m])), [metrics.data]) as Record<string, MetricInfo>

  const refreshSignals = async () => {
    setPrev(signals.data ?? [])
    await signals.reload()
  }
  const flash = (k: string) => { setSaved(k); setTimeout(() => setSaved((s) => (s === k ? null : s)), 1400) }

  // Оптимистично меняем правило; на бэкенд — с задержкой, чтобы слайдер не спамил запросами.
  const setRule = (id: string, patch: Partial<MetricRule>) => {
    settings.setData((s) => s && { ...s, metrics: { ...s.metrics, [id]: { ...s.metrics[id], ...patch } } })
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(async () => {
      try { await api.putMetricRule(id, patch); flash(id); await refreshSignals() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    }, 450)
  }
  const setDetector = (k: string, v: number) => {
    settings.setData((s) => s && { ...s, detector: { ...s.detector, [k]: v } })
    clearTimeout(timers.current[k])
    timers.current[k] = setTimeout(async () => {
      try { await api.putSettings({ detector: { [k]: v } } as Partial<Settings>); flash(k); await refreshSignals() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    }, 500)
  }
  const reset = async () => {
    try { settings.setData(await api.resetSettings()); flash('reset'); await refreshSignals() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  // Демонстрация критерия приёмки №5 в один клик.
  const demo = (t: number) => setRule('family_orders_idx', { threshold: t, enabled: true })

  const s = settings.data
  const ordersRule = s?.metrics.family_orders_idx
  const kes = signals.data?.find((x) => x.kind === 'sales_drop')
  const kesDrop = kes?.change ? Math.abs(kes.change.change_pct) : null

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="teal" icon={<Icons.settings />}>Настройки детектора</Kicker>}
        title={<>Пороги — <Hl tone="teal">под ваш продукт</Hl></>}
        lead={<>Меняете порог — детектор <b>сразу пересчитывает сигналы</b>. Статистику считает код, а не модель,
          поэтому результат <b>повторяемый</b>: тот же порог — тот же сигнал.</>}
      />
      {err && <ErrorBox error={err} />}
      {(settings.loading || metrics.loading) && !s && <Loading />}

      {s && (
        <div className="grid grid-main-side" style={{ alignItems: 'start' }}>
          <div className="stack" style={{ gap: 16 }}>
            {ordersRule && (
              <section className="card try-card reveal">
                <div className="eyebrow">попробуйте</div>
                <p className="try-text">
                  Сейчас заказы KES упали на <b>{kesDrop != null ? `${kesDrop}%` : '…'}</b>, порог — <b>{ordersRule.threshold}%</b>.
                  Поднимите порог выше падения — сигнал <Hl tone="red" sm>исчезнет</Hl>; верните — появится снова.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={() => demo(40)}>Порог 40% — сигнала нет</button>
                  <button className="btn btn-primary" onClick={() => demo(20)}>Вернуть 20%</button>
                </div>
              </section>
            )}

            <section className="card reveal">
              <div className="card-head">
                <h2>Правила по метрикам</h2>
                <button className="btn btn-sm btn-ghost" onClick={reset}>{saved === 'reset' ? 'Сброшено' : 'Сбросить к справочнику'}</button>
              </div>
              <div className="rules">
                {Object.entries(s.metrics).map(([id, r]) => {
                  const info = RULES[r.rule] ?? RULES.pct_drop
                  const m = names[id]
                  return (
                    <div key={id} className={`rule${r.enabled ? '' : ' off'}${saved === id ? ' saved' : ''}`}>
                      <div className="rule-head">
                        <label className="switch" title={r.enabled ? 'Выключить правило' : 'Включить правило'}>
                          <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(id, { enabled: e.target.checked })} />
                          <span />
                        </label>
                        <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                          <b className="rule-name">{m?.metric_name ?? id}</b>
                          <span className="faint mono">{id}{m?.bad_signal ? ` · справочник: ${m.bad_signal}` : ''}</span>
                        </div>
                        <select value={r.priority} onChange={(e) => setRule(id, { priority: e.target.value })} aria-label="Приоритет сигнала">
                          {['Critical', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}
                        </select>
                        {saved === id && <span className="saved-tick">✓</span>}
                      </div>
                      {r.rule !== 'zero_week' ? (
                        <div className="rule-ctrl">
                          <span className="rule-kind">{info.label}</span>
                          <input type="range" min={info.min} max={info.max} step={info.step} value={r.threshold} disabled={!r.enabled}
                            onChange={(e) => setRule(id, { threshold: Number(e.target.value) })}
                            style={{ ['--p' as string]: `${((r.threshold - info.min) / (info.max - info.min)) * 100}%` }} />
                          <span className="rule-val">{r.threshold}<small>{info.unit}</small></span>
                        </div>
                      ) : <div className="faint" style={{ paddingLeft: 52 }}>{info.hint(0)}</div>}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="card reveal">
              <div className="card-head"><h2>Параметры детектора</h2><span className="faint">одинаковы для всех метрик</span></div>
              <div className="grid grid-2" style={{ gap: 10 }}>
                {Object.entries(DETECTOR).filter(([k]) => k in s.detector).map(([k, d]) => (
                  <label key={k} className={`param${saved === k ? ' saved' : ''}`}>
                    <span className="stat-label">{d.label}</span>
                    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <input type="number" value={s.detector[k]} step={d.step ?? 1} min={0} onChange={(e) => setDetector(k, Number(e.target.value))} />
                      <span className="faint">{d.unit}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="card reveal">
              <div className="card-head"><h2>Вес источников в выводе</h2><span className="faint">фиксированы в прототипе</span></div>
              <div className="stack" style={{ gap: 10 }}>
                {Object.entries(s.sources_weights).map(([k, w]) => (
                  <div key={k} className="weight">
                    <span>{SOURCES[k] ?? k}</span>
                    <span className="weight-bar"><span style={{ width: `${w * 100}%` }} /></span>
                    <b className="mono">{Math.round(w * 100)}%</b>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="inv-aside stack" style={{ gap: 16 }}>
            <LivePreview signals={signals.data ?? []} loading={signals.loading} prev={prev} />
          </aside>
        </div>
      )}
    </>
  )
}

function LivePreview({ signals, loading, prev }: { signals: Signal[]; loading: boolean; prev: Signal[] }) {
  const ids = signals.map((s) => s.id)
  const prevIds = prev.map((s) => s.id)
  const names = useMetricNames()
  const gone = prev.filter((s) => !ids.includes(s.id))
  const [pulse, setPulse] = useState(false)
  useEffect(() => { setPulse(true); const t = setTimeout(() => setPulse(false), 700); return () => clearTimeout(t) }, [signals])
  return (
    <section className={`card live-preview${pulse ? ' pulse' : ''}`}>
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}><span className="live-dot" /> Сигналы сейчас</h2>
        {loading && <span className="spinner" />}
      </div>
      <div className="live-count"><CountUp value={signals.length} duration={600} /><span>активных</span></div>
      {gone.length > 0 && <div className="callout callout-warning faint" style={{ marginBottom: 10 }}>Пропал сигнал: {gone.map((g) => signalTitle(g, names)).join('; ')}</div>}
      <div className="index-list">
        {signals.map((s, i) => <SignalRow key={s.id} s={s} names={names} index={i + 1} isNew={prevIds.length > 0 && !prevIds.includes(s.id)} />)}
        {!loading && signals.length === 0 && <div className="board-empty">Ни одного сигнала при текущих порогах</div>}
      </div>
    </section>
  )
}
