import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'minipm.theme'

function initial(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch { /* без памяти */ }
  return 'dark' // тёмная — основная тема продукта
}

function apply(t: Theme) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}

apply(initial())

/** Тема + подписка: графики ECharts перечитывают CSS-переменные при смене. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial)
  useEffect(() => {
    apply(theme)
    try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('minipm-theme', { detail: theme }))
  }, [theme])
  return [theme, setTheme] as const
}

/** Текущая тема для компонентов, которым нужно перерисоваться (графики). */
export function useThemeValue(): Theme {
  const [t, setT] = useState<Theme>(initial)
  useEffect(() => {
    const h = (e: Event) => setT((e as CustomEvent<Theme>).detail)
    window.addEventListener('minipm-theme', h)
    return () => window.removeEventListener('minipm-theme', h)
  }, [])
  return t
}

/** Цвет с прозрачностью для ECharts. Понимает #rgb, #rrggbb и rgb()/rgba() —
 *  простое `color + '55'` ломается на коротком hex (#000 → #00055, график падает с ошибкой). */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim()
  let m = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (m) return `rgba(${parseInt(m[1] + m[1], 16)},${parseInt(m[2] + m[2], 16)},${parseInt(m[3] + m[3], 16)},${alpha})`
  m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
  if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`
  return c
}

/** Значение CSS-переменной темы (для ECharts, который не понимает var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
