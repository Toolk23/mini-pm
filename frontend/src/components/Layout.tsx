import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { setUseMocks, useMocks, api } from '../api/client'
import { Icons, useApi } from './ui'
import { useTheme } from './theme'
import BgField from './BgField'

// Верхнее меню в духе Resend / Raycast: логотип — разделы по центру — действия справа.
const NAV = [
  { to: '/', label: 'Радар', end: true },
  { to: '/story', label: 'История' },
  { to: '/investigations', label: 'Расследования' },
  { to: '/mail', label: 'Письма' },
  { to: '/backlog', label: 'Бэклог' },
  { to: '/sales', label: 'Продажам' },
  { to: '/knowledge', label: 'Знания' },
] as const

export default function Layout() {
  const loc = useLocation()
  const nav = useNavigate()
  const [mock, setMock] = useState(useMocks)

  // Ctrl+K / ⌘K — чат с любой страницы (как командная строка Raycast).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault()
        nav('/chat')
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [nav])
  const [theme, setTheme] = useTheme()
  const health = useApi(() => api.health(), [mock])
  const [scrolled, setScrolled] = useState(false)

  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 8)
        const max = document.documentElement.scrollHeight - window.innerHeight
        setProgress(max > 0 ? Math.round((window.scrollY / max) * 100) : 0)
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [loc.pathname])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  // Высота шапки в CSS-переменной --nav-h: липкие элементы (степпер, боковые колонки) встают ровно под неё
  // при любой ширине, без щели, в которой просвечивает текст.
  useEffect(() => {
    const el = document.querySelector('.navbar')
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--nav-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Появление при прокрутке: CSS-анимации .reveal / .line-mask / .hairline-draw стоят на паузе,
  // пока элемент не попал в экран (один раз). Новые элементы после загрузки данных ловит MutationObserver.
  useEffect(() => {
    const SEL = '.reveal, .line-mask, .hairline-draw'
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll(SEL).forEach((el) => el.setAttribute('data-inview', ''))
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.setAttribute('data-inview', ''); io.unobserve(e.target) } })
    }, { rootMargin: '0px 0px -8% 0px' })
    const watch = (root: ParentNode) => root.querySelectorAll(SEL).forEach((el) => { if (!el.hasAttribute('data-inview')) io.observe(el) })
    watch(document)
    const mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
      if (n instanceof Element) { if (n.matches(SEL)) io.observe(n); watch(n) }
    })))
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect() }
  }, [])

  // 3D-глубина: элементы с data-depth чуть сдвигаются за курсором (чем больше depth — тем «ближе»),
  // data-tilt наклоняется в перспективе. Только мышь, не при «уменьшить движение».
  // Transform ставим прямо на элемент, а не через CSS-переменную на родителе — без пересчёта стилей детей.
  useEffect(() => {
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0
    const tick = () => {
      x += (tx - x) * 0.08; y += (ty - y) * 0.08
      document.querySelectorAll<HTMLElement>('[data-depth]').forEach((el) => {
        const d = Number(el.dataset.depth) || 0
        el.style.transform = `translate3d(${(x * d).toFixed(2)}px, ${(y * d).toFixed(2)}px, 0)`
      })
      document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
        el.style.transform = `perspective(900px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 14).toFixed(2)}deg)`
      })
      if (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    const on = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5
      if (!raf) raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', on, { passive: true })
    return () => { window.removeEventListener('pointermove', on); cancelAnimationFrame(raf) }
  }, [])

  const toggleMock = () => {
    setUseMocks(!mock)
    setMock(!mock)
    window.location.reload()
  }

  return (
    <>
      <div className="backdrop" aria-hidden>
        <div className="aurora aurora-1" /><div className="aurora aurora-2" /><div className="aurora aurora-3" />
        <div className="noise" />
        <BgField />
      </div>

      <div className="app">
        <header className={`navbar${scrolled ? ' scrolled' : ''}`}>
          <div className="navbar-inner">
            <Link to="/" className="brand" aria-label="мини ПМ — на радар">
              <span className="brand-logo">ПМ</span>
              <span className="brand-name">мини ПМ</span>
            </Link>

            <nav className="nav">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={'end' in n} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  {n.label}
                </NavLink>
              ))}
            </nav>

            <div className="nav-actions">
              {health.error && !mock && <span className="badge badge-critical">бэкенд недоступен</span>}
              <button className={`icon-btn${mock ? ' on' : ''}`} onClick={toggleMock}
                title={mock ? 'Данные: моки (без сервера). Нажми, чтобы перейти на API' : 'Данные: API. Нажми, чтобы включить моки'}>
                {mock ? 'M' : 'API'}
              </button>
              <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title="Тёмная / светлая тема" aria-label="Сменить тему">
                {theme === 'dark' ? '☀' : '☾'}
              </button>
              <NavLink to="/settings" className={({ isActive }) => `icon-btn${isActive ? ' on' : ''}`} title="Настройки порогов" aria-label="Настройки">
                <Icons.settings />
              </NavLink>
              {/* На узких экранах большая кнопка не помещается — вместо неё иконка чата. */}
              <NavLink to="/chat" className={({ isActive }) => `icon-btn chat-mini${isActive ? ' on' : ''}`} title="Спросить мини ПМ" aria-label="Чат с мини ПМ">
                <Icons.chat />
              </NavLink>
              <NavLink to="/chat" className="btn btn-primary btn-cta" title="Ctrl+K — с любой страницы">
                Спросить мини ПМ <span className="kbd kbd-on-light">Ctrl K</span>
              </NavLink>
            </div>
          </div>
        </header>

        <main className="content" key={loc.pathname}>
          <Outlet />
        </main>

        {/* Передний слой дыма — только углы, поверх контента, но под шапкой: даёт глубину. */}
        <div className="bg-front" aria-hidden><BgField layer="front" /></div>

        <div className="scroll-progress" aria-hidden>
          <span className="sp-bars">{[0, 1, 2].map((i) => <i key={i} className={progress >= (i + 1) * 33 ? 'on' : ''} />)}</span>{progress}%
        </div>
        <footer className="footer">
          <span className="row"><span className="live-dot" /> агент следит за метриками store.softline.ru</span>
          <span className="row">
            <span className="badge" title="Модель LLM">
              {health.data ? (health.data.llm.configured ? `LLM: ${health.data.llm.model}` : 'LLM: шаблон') : '…'}
            </span>
            {mock && <span className="badge">данные: моки</span>}
            <span>мини ПМ · ИИкузница 2026</span>
          </span>
        </footer>
      </div>
    </>
  )
}
