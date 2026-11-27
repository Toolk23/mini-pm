// Мок-сервер по контракту docs/api.md. Данные — реальные ответы бэкенда, снятые scripts/dump_mocks.py.
// Состояние (задачи, гипотезы, расследования) живёт в памяти вкладки — для демо без бэкенда.
import health from './data/health.json'
import metrics from './data/metrics.json'
import signals from './data/signals.json'
import releases from './data/releases.json'
import dataGaps from './data/data-gaps.json'
import sales from './data/sales.json'
import backlog from './data/backlog.json'
import settings from './data/settings.json'
import seriesAll from './data/series.json'
import investigation from './data/investigation.json'
import applied from './data/apply.json'
import measureRecovered from './data/measure-recovered.json'
import measureNotRecovered from './data/measure-not-recovered.json'
import chat from './data/chat.json'
import search from './data/search.json'
import redmine from './data/redmine.json'
import metrikaLive from './data/metrika-live.json'
import salesBrief from './data/sales-brief.json'
import storefrontCard from './data/storefront-card.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

const state = {
  tasks: clone(backlog) as any[],
  hypotheses: [] as any[],
  settings: clone(settings) as any,
  investigations: {} as Record<string, any>,
  uploads: 0,
  briefs: [] as any[],
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function route(method: string, path: string, body: any): any {
  const [p, query = ''] = path.split('?')
  const q = new URLSearchParams(query)
  const m = (re: RegExp) => p.match(re)
  let r: RegExpMatchArray | null

  if (method === 'GET' && p === '/health') return health
  if (method === 'GET' && p === '/metrics') return metrics
  if (method === 'GET' && (r = m(/^\/metrics\/([^/]+)\/series$/))) {
    const key = `${decodeURIComponent(r[1])}|${q.get('product') || ''}`
    const all = seriesAll as Record<string, any>
    return all[key] || Object.values(all).find((s: any) => s.metric_id === decodeURIComponent(r![1])) || Object.values(all)[0]
  }
  if (method === 'GET' && p === '/sales') return sales
  if (method === 'GET' && p === '/releases') return releases
  if (method === 'GET' && p === '/data-gaps') return dataGaps
  if (method === 'GET' && p === '/signals') {
    // Имитация порогов: сигнал по продажам пропадает, если порог выше фактического падения.
    const rule = state.settings.metrics?.family_orders_idx
    return (signals as any[]).filter((s) => {
      const rr = state.settings.metrics?.[s.metric_id]
      if (rr && rr.enabled === false) return false
      if (s.kind === 'sales_drop' && rule && s.change) return Math.abs(s.change.change_pct) >= rule.threshold
      return true
    })
  }

  if (method === 'POST' && p === '/investigations') {
    const id = 'INV-MOCK' + Math.random().toString(16).slice(2, 4).toUpperCase()
    const job = { id, status: 'running', signal_id: body.signal_id, created_at: new Date().toISOString() }
    state.investigations[id] = job
    setTimeout(() => Object.assign(job, { status: 'done', report: { ...clone(investigation.report), id } }), 4000)
    return job
  }
  if (method === 'GET' && p === '/investigations')
    return Object.values(state.investigations).map(({ report: _r, ...rest }) => rest)
  if (method === 'GET' && (r = m(/^\/investigations\/([^/]+)$/))) {
    const job = state.investigations[r[1]]
    if (job) return job
    return { ...clone(investigation), id: r[1] }
  }
  if (method === 'POST' && (r = m(/^\/investigations\/([^/]+)\/apply$/))) {
    const job = state.investigations[r[1]] || (state.investigations[r[1]] = { ...clone(investigation), id: r[1] })
    if (job.applied) return job.applied
    const res = clone(applied) as any
    if (!state.tasks.find((t) => t.task_id === res.task.task_id)) state.tasks.push(res.task)
    res.raised.forEach((x: any) => {
      const t = state.tasks.find((t) => t.task_id === x.task_id)
      if (t) t.priority = x.new_priority
    })
    if (!state.hypotheses.find((h) => h.id === res.hypothesis.id)) state.hypotheses.push(res.hypothesis)
    job.applied = res
    return res
  }

  if (method === 'GET' && p === '/backlog/tasks') return state.tasks
  if (method === 'POST' && p === '/backlog/tasks') {
    const n = state.tasks.length + 1
    const t = { task_id: `T-${String(n).padStart(2, '0')}`, status: 'New', type: 'Задача', tags: ['сгенерирована ИИ-помощником'],
      history: [], created_date: new Date().toISOString().slice(0, 10), ...body }
    state.tasks.push(t)
    return t
  }
  if (method === 'PATCH' && (r = m(/^\/backlog\/tasks\/([^/]+)$/))) {
    const t = state.tasks.find((t) => t.task_id === r![1])
    Object.entries(body).forEach(([k, v]) => v != null && (t[k] = v))
    return t
  }
  if (method === 'GET' && (r = m(/^\/backlog\/tasks\/([^/]+)\/redmine$/))) {
    const t = state.tasks.find((t) => t.task_id === r![1])
    const out = clone(redmine) as any
    if (t) Object.assign(out.issue, { subject: t.title, description: t.description, tag_list: t.tags })
    return out
  }

  if (method === 'GET' && p === '/hypotheses') return state.hypotheses
  if (method === 'POST' && (r = m(/^\/hypotheses\/([^/]+)\/measure$/))) {
    const res = body?.scenario === 'not_recovered' ? measureNotRecovered : measureRecovered
    const h = state.hypotheses.find((h) => h.id === r![1])
    if (h) {
      Object.assign(h, { status: res.verdict, measurement: res })
      const t = state.tasks.find((t) => t.task_id === h.task_id)
      if (t) t.status = res.verdict === 'confirmed' ? 'Done' : 'Reopened'
    }
    return res
  }

  if (method === 'GET' && p === '/settings') return state.settings
  if (method === 'PUT' && (r = m(/^\/settings\/metrics\/([^/]+)$/))) {
    state.settings.metrics[r[1]] = { ...state.settings.metrics[r[1]], ...body }
    return state.settings.metrics[r[1]]
  }
  if (method === 'PUT' && p === '/settings') {
    state.settings = { ...state.settings, ...body, detector: { ...state.settings.detector, ...(body?.detector ?? {}) },
      metrics: { ...state.settings.metrics, ...(body?.metrics ?? {}) } }
    return state.settings
  }
  if (method === 'POST' && p === '/settings/reset') {
    state.settings = clone(settings)
    return state.settings
  }

  if (method === 'GET' && p === '/knowledge/search') return search
  if (method === 'POST' && p === '/knowledge/upload') { state.uploads += 6; return { file: body?.get?.('file')?.name ?? 'файл', chunks_added: 6 } }
  if (method === 'POST' && p === '/knowledge/reindex') return { chunks: 1180 + state.uploads, by_source: { interview: 742, competitor: 438, ...(state.uploads ? { upload: state.uploads } : {}) }, seconds: 1.2 }
  if (method === 'POST' && p === '/chat') return chat
  if (method === 'GET' && p === '/metrika/live') return metrikaLive
  if (method === 'GET' && p === '/storefront/card') return storefrontCard
  if (method === 'POST' && (r = m(/^\/investigations\/([^/]+)\/send-email$/))) return { ok: false, error: 'SMTP не настроен (режим моков)' }
  if (method === 'GET' && p === '/sales-briefs') return state.briefs.map(({ evidence: _e, ...b }) => b)
  if (method === 'GET' && (r = m(/^\/sales-briefs\/([^/]+)$/))) return state.briefs.find((b) => b.id === r![1]) ?? salesBrief
  if (method === 'POST' && p === '/sales-briefs') {
    const b = { ...clone(salesBrief), id: 'SB-MOCK' + (state.briefs.length + 1), family: body?.product ?? 'KES', created_at: new Date().toISOString() }
    state.briefs.unshift(b)
    return b
  }
  if (method === 'POST' && (r = m(/^\/sales-briefs\/([^/]+)\/send$/))) return { ok: false, error: 'SMTP не настроен (режим моков)' }

  throw new Error(`Мок не знает ${method} ${path}`)
}

export async function mockRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await delay(path.startsWith('/chat') ? 900 : method === 'POST' && path === '/sales-briefs' ? 6000 : 150)
  return clone(route(method, path, body)) as T
}
