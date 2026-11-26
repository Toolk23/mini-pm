import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { setUseMocks, useMocks, api } from '../api/client'
import { Icons, useApi } from './ui'

const NAV = [
  { section: 'Радар' },
  { to: '/', label: 'Дашборд', icon: Icons.dashboard, end: true },
  { to: '/story', label: 'Сквозная история', icon: Icons.story },
  { section: 'Следствие' },
  { to: '/investigations', label: 'Расследования', icon: Icons.investigation },
  { to: '/mail', label: 'Письма ПМу', icon: Icons.mail },
  { to: '/backlog', label: 'Бэклог', icon: Icons.backlog },
  { section: 'Помощник' },
  { to: '/chat', label: 'Чат с мини ПМ', icon: Icons.chat },
  { to: '/knowledge', label: 'База знаний', icon: Icons.knowledge },
  { to: '/settings', label: 'Настройки', icon: Icons.settings },
] as const

const TITLES: Record<string, string> = {
  '': 'Дашборд', story: 'Сквозная история', investigations: 'Расследования', mail: 'Письма ПМу',
  backlog: 'Бэклог', chat: 'Чат с мини ПМ', knowledge: 'База знаний', settings: 'Настройки',
}

export default function Layout() {
  const loc = useLocation()
  const [mock, setMock] = useState(useMocks)
  const health = useApi(() => api.health(), [mock])
  const title = TITLES[loc.pathname.split('/')[1] ?? ''] ?? 'мини ПМ'

  const toggleMock = () => {
    setUseMocks(!mock)
    setMock(!mock)
    window.location.reload()
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">ПМ</div>
          <div>
            <div className="brand-name">мини ПМ</div>
            <div className="brand-sub">ИИ-помощник продакта</div>
          </div>
        </div>
        {NAV.map((n, i) =>
          'section' in n ? (
            <div key={i} className="nav-section">{n.section}</div>
          ) : (
            <NavLink key={n.to} to={n.to} end={'end' in n} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <n.icon /> {n.label}
            </NavLink>
          ),
        )}
        <div className="sidebar-foot">
          <div className="row">
            <span className="badge" title="Модель LLM">
              {health.data ? (health.data.llm.configured ? `LLM: ${health.data.llm.model}` : 'LLM: шаблон') : '…'}
            </span>
          </div>
          <span>store.softline.ru · ИИкузница 2026</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{title}</span>
          <span className="topbar-spacer" />
          {health.error && !mock && <span className="badge badge-critical">бэкенд недоступен</span>}
          <button className={`btn btn-sm ${mock ? '' : 'btn-ghost'} mock-pill`} onClick={toggleMock}
            title="Моки — снятые ответы бэкенда, работают без сервера">
            {mock ? 'Данные: моки' : 'Данные: API'}
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
