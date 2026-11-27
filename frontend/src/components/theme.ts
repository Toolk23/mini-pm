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

/** Значение CSS-переменной темы (для ECharts, который не понимает var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
