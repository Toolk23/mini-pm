import { useEffect, useRef, useState } from 'react'
import type { Signal } from '../api/types'

/** Число «набегает» от 0 до значения — живые KPI. */
export function CountUp({ value, digits = 0, prefix = '', suffix = '', duration = 1300, signed = false }:
  { value: number; digits?: number; prefix?: string; suffix?: string; duration?: number; signed?: boolean }) {
  const [v, setV] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setV(value); return }
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const e = 1 - Math.pow(1 - p, 4) // easeOutQuart
      setV(value * e)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : ''
  const abs = Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return <span>{prefix}{sign}{abs}{suffix}</span>
}

const PRIORITY_COLOR: Record<string, string> = { Critical: 'var(--danger)', High: 'var(--warning)', Medium: 'var(--accent)' }

/** Радар: вращающийся луч + «засечки» сигналов. Иллюстрация того, что агент постоянно смотрит на метрики. */
export function Radar({ signals = [], size = 260 }: { signals?: Signal[]; size?: number }) {
  // Детерминированные позиции засечек по id сигнала.
  const blips = signals.slice(0, 7).map((s, i) => {
    let h = 0
    for (const c of s.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const angle = ((h % 360) + i * 47) % 360
    const r = s.priority === 'Critical' ? 0.32 : 0.48 + ((h >> 8) % 30) / 100
    return { id: s.id, title: s.title, x: 50 + Math.cos((angle * Math.PI) / 180) * r * 50, y: 50 + Math.sin((angle * Math.PI) / 180) * r * 50,
      color: PRIORITY_COLOR[s.priority] ?? 'var(--text-2)', critical: s.priority === 'Critical', delay: (angle / 360) * 4 }
  })
  return (
    <div className="radar" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" className="radar-rings">
        {[48, 36, 24, 12].map((r) => <circle key={r} cx="50" cy="50" r={r} />)}
        <line x1="2" y1="50" x2="98" y2="50" /><line x1="50" y1="2" x2="50" y2="98" />
      </svg>
      <div className="radar-sweep" />
      {blips.map((b) => (
        <span key={b.id} className={`radar-blip${b.critical ? ' critical' : ''}`} title={b.title}
          style={{ left: `${b.x}%`, top: `${b.y}%`, ['--c' as string]: b.color, animationDelay: `${b.delay}s` }} />
      ))}
      <div className="radar-core" />
    </div>
  )
}
