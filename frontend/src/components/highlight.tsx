import type { ReactNode } from 'react'

type Tone = 'red' | 'warm' | 'violet' | 'teal' | 'green'

/** Слово-маркер в стиле Raycast («Put the Pro in Productivity»). */
export function Hl({ children, tone = 'red', sm = false }: { children: ReactNode; tone?: Tone; sm?: boolean }) {
  return <span className={`hl hl-${tone}${sm ? ' hl-sm' : ''}`}>{children}</span>
}

/** Надзаголовок секции: цветная иконка + подпись. */
export function Kicker({ children, tone = 'blue', icon }: { children: ReactNode; tone?: 'blue' | 'red' | 'warm' | 'teal' | 'violet'; icon?: ReactNode }) {
  return <span className={`kicker kicker-${tone}`}>{icon}{children}</span>
}

export function SectionHead({ kicker, title, lead }: { kicker: ReactNode; title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="section-head reveal">
      {kicker}
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
    </div>
  )
}

// R-09, T-08, −33.9%, «нет данных», «не измеряется»
const TOKEN = /(\b[RT]-\d{2}\b|[-−+]?\d+(?:[.,]\d+)?\s?%|нет данных|не измеряется|не подтверждено внешними источниками)/g

/**
 * Автоподсветка в тексте отчёта: ID релизов и задач — маркеры, проценты — жирные (падение светится),
 * «нет данных» — пунктиром. hot — ID, который надо выделить красным (главный кандидат).
 */
export function Rich({ text, hot }: { text: string; hot?: string[] }) {
  const parts = text.split(TOKEN)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p
        if (/^[RT]-\d{2}$/.test(p)) return <span key={i} className={`tok-id${hot?.includes(p) ? ' hot' : ''}`}>{p}</span>
        if (/%$/.test(p)) return <span key={i} className={`tok-num${/^[-−]/.test(p) ? ' neg' : ''}`}>{p}</span>
        return <span key={i} className="tok-nodata">{p}</span>
      })}
    </>
  )
}

/* иконки для надзаголовков */
const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
export const KIcons = {
  radar: () => svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12 18 6" /></>),
  pulse: () => svg(<path d="M3 12h4l3-7 4 14 3-7h4" />),
  search: () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  bolt: () => svg(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
  flask: () => svg(<><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" /><path d="M7 15h10" /></>),
  send: () => svg(<path d="m22 2-7 20-4-9-9-4z M22 2 11 13" />),
}
