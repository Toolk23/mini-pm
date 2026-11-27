import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './styles/global.css'
import './styles/hackfirst.css' // дизайн v2; убрать строку — вернётся v1
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Story from './pages/Story'
import Investigations from './pages/Investigations'
import InvestigationPage from './pages/InvestigationPage'
import Mail from './pages/Mail'
import Backlog from './pages/Backlog'
import Chat from './pages/Chat'
import Knowledge from './pages/Knowledge'
import Sales from './pages/Sales'
import SettingsPage from './pages/Settings'
import NotFound from './pages/NotFound'

// Метка сборки: видно в DevTools, какая версия фронта открыта (помогает ловить старый кэш).
document.documentElement.dataset.build = '2026-11-27-v3'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="story" element={<Story />} />
          <Route path="investigations" element={<Investigations />} />
          <Route path="investigations/:id" element={<InvestigationPage />} />
          <Route path="mail" element={<Mail />} />
          <Route path="mail/:id" element={<Mail />} />
          <Route path="backlog" element={<Backlog />} />
          <Route path="chat" element={<Chat />} />
          <Route path="sales" element={<Sales />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
