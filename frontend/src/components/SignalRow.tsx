import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { MetricInfo, Signal } from '../api/types'
import { Rich } from './highlight'
import { PriorityBadge } from './ui'

/* ---------- человеческие названия метрик (справочник грузится один раз) ---------- */
let catalog: Promise<Record<string, MetricInfo>> | null = null
function loadCatalog() {
  catalog ??= api.metrics()
    .then((list) => Object.fromEntries(list.map((m) => [m.metric_id, m])))
    .catch(() => { catalog = null; return {} })
  return catalog
}
export function useMetricNames(): Record<string, MetricInfo> {
  const [names, setNames] = useState<Record<string, MetricInfo>>({})
  useEffect(() => { let on = true; loadCatalog().then((n) => on && setNames(n)); return () => { on = false } }, [])
  return names
}

const PRODUCT_SHORT: Record<string, string> = {
  'Kaspersky Endpoint Security': 'Kaspersky',
  'Конфигуратор Kaspersky': 'Kaspersky',
  'Конфигуратор Астра': 'Astra',
  'Astra Linux Special Edition': 'Astra',
  'ЛК': 'Личный кабинет',
}

/**
 * Заголовок сигнала без технических id: «lk_reco_click_visits: 5 нед. без событий из 15»
 * → «Визиты с кликом по рекомендациям: 5 нед. без событий из 15»; «(Конфигуратор Астра)» уходит в подпись.
 */
export function signalTitle(s: Signal, names: Record<string, MetricInfo>): string {
  let t = s.title
  const name = names[s.metric_id]?.metric_name
  if (name) t = t.replace(new RegExp(`^${s.metric_id}\\b`), name)
  return t.replace(/\s*\((Конфигуратор [^)]+|ЛК)\)/, '')
}

const ico = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
const KIND_ICON: Record<string, ReactNode> = {
  sales_drop: ico(<><path d="M3 7l6 6 4-4 8 8" /><path d="M21 11v6h-6" /></>),
  zero_weeks: ico(<><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>),
  metric_change: ico(<path d="M3 12h4l3-7 4 14 3-7h4" />),
}

/** Строка сигнала в стиле списков Raycast: иконка-плитка · название · подпись; действие справа при наведении. */
export function SignalRow({ s, names, action, as = 'div', onClick, href, isNew, style }: {
  s: Signal; names: Record<string, MetricInfo>; action?: ReactNode; as?: 'div' | 'button' | 'a'
  onClick?: () => void; href?: string; isNew?: boolean; style?: React.CSSProperties
}) {
  const prio = s.priority.toLowerCase()
  const meta = [PRODUCT_SHORT[s.product] ?? s.product, s.change?.post_period?.replace(/\.2026/g, '')].filter(Boolean).join(' · ')
  const inner = (
    <>
      <span className={`sig-icon prio-${prio}`}>{KIND_ICON[s.kind] ?? KIND_ICON.metric_change}</span>
      <span className="sig-main">
        <span className="sig-title"><Rich text={signalTitle(s, names)} /></span>
        <span className="sig-meta"><PriorityBadge p={s.priority} /><span className="sig-dot-sep" />{meta}</span>
      </span>
      {action && <span className="sig-action">{action}</span>}
    </>
  )
  const cls = `sig-row reveal${isNew ? ' is-new' : ''}${onClick || href ? ' clickable' : ''}`
  if (as === 'button') return <button type="button" className={cls} onClick={onClick} style={style}>{inner}</button>
  if (as === 'a') return <a className={cls} href={href} onClick={(e) => { if (onClick) { e.preventDefault(); onClick() } }} style={style}>{inner}</a>
  return <div className={cls} style={style}>{inner}</div>
}
