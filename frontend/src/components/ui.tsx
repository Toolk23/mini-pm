import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export const AI_TAG = 'сгенерирована ИИ-помощником'

/** Загрузка данных с состояниями loading / error / reload. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fnRef.current())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, deps)
  return { data, error, loading, reload, setData }
}

const PRIORITY_RU: Record<string, string> = { Critical: 'Критичный', High: 'Высокий', Medium: 'Средний', Low: 'Низкий' }

/** Приоритет — точка + подпись (как статусы в Linear/Raycast), без цветной таблетки. */
export function PriorityBadge({ p }: { p: string }) {
  const k = ['Critical', 'High', 'Medium', 'Low'].includes(p) ? p.toLowerCase() : 'none'
  return <span className={`prio prio-${k}`}><i aria-hidden />{PRIORITY_RU[p] ?? p}</span>
}

export function AiBadge() {
  return (
    <span className="badge badge-ai" title="Задачу создал агент «мини ПМ»">
      {AI_TAG}
    </span>
  )
}

/** «Нет данных» ≠ ноль: отдельный визуальный язык (штриховка, пунктир). */
export function NoData({ title = 'Нет данных', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="nodata">
      <div className="nodata-title"><NoDataIcon /> {title}</div>
      <div>{children}</div>
    </div>
  )
}

export function NoDataBadge({ label = 'нет данных' }: { label?: string }) {
  return <span className="badge badge-nodata">{label}</span>
}

export function Loading({ label = 'Загружаю…' }: { label?: string }) {
  return <div className="empty row" style={{ justifyContent: 'center' }}><span className="spinner" /> {label}</div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error-box row" style={{ justifyContent: 'space-between' }}>
      <span>Не получилось загрузить: {error}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Повторить</button>}
    </div>
  )
}

export function Card({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {extra}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const fmtPct = (v?: number | null, digits = 0) =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`

/* ---------- иконки (inline SVG, currentColor) ---------- */
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
export const Icons = {
  dashboard: () => svg(<><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>),
  story: () => svg(<><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M6 8l5 8M18 8l-5 8" /></>),
  investigation: () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  mail: () => svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  backlog: () => svg(<><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>),
  chat: () => svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />),
  knowledge: () => svg(<><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M9 7h6M9 11h6" /></>),
  settings: () => svg(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>),
}
export function SparkIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7z" /></svg>
}
export function NoDataIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
}
