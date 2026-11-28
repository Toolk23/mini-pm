import type {
  ApplyResult, ChatMessage, ChatResponse, Health, HypothesisRecord, Investigation, KnowledgeHit,
  Measurement, MetricInfo, MetricRule, MetricSeries, MetrikaLive, Release, Settings, Signal, Task, DataGap, UploadResult, IndexStats, MailSent, StorefrontCard, SalesBrief,
} from './types'
import { mockRequest } from '../mocks/mockServer'

// Режим моков: VITE_USE_MOCKS=1 при сборке, ?mock=1 в адресе или переключатель в шапке (localStorage).
const MOCK_KEY = 'minipm.mock'

function readMockFlag(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('mock')
    if (q === '1' || q === '0') localStorage.setItem(MOCK_KEY, q)
    const stored = localStorage.getItem(MOCK_KEY)
    if (stored === '1' || stored === '0') return stored === '1'
  } catch { /* приватный режим — просто без памяти */ }
  return import.meta.env.VITE_USE_MOCKS === '1'
}

export let useMocks = readMockFlag()

export function setUseMocks(v: boolean) {
  useMocks = v
  try { localStorage.setItem(MOCK_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (useMocks) return mockRequest<T>(method, path, body)
  const init: RequestInit = { method, headers: {} }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  let res = await fetch(`/api${path}`, init)
  // Холодный старт стенда: первые параллельные чтения иногда отдают 5xx — повторяем GET один раз.
  if (res.status >= 500 && method === 'GET') {
    await new Promise((r) => setTimeout(r, 700))
    res = await fetch(`/api${path}`, init)
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { /* не JSON */ }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

const qs = (p: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams()
  Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && s.set(k, String(v)))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export interface RankedTask {
  task_id: string; title: string; status: string; priority: string
  score: number; action: string; reasons: string[]; tags: string[]
}

export const api = {
  health: () => request<Health>('GET', '/health'),
  metrics: () => request<MetricInfo[]>('GET', '/metrics'),
  series: (metricId: string, product?: string) =>
    request<MetricSeries>('GET', `/metrics/${encodeURIComponent(metricId)}/series${qs({ product })}`),
  sales: () => request<Record<string, Signal['series']>>('GET', '/sales'),
  releases: () => request<Release[]>('GET', '/releases'),
  dataGaps: () => request<DataGap[]>('GET', '/data-gaps'),
  signals: () => request<Signal[]>('GET', '/signals'),

  startInvestigation: (signal_id: string) => request<Investigation>('POST', '/investigations', { signal_id }),
  investigations: () => request<Investigation[]>('GET', '/investigations'),
  investigation: (id: string) => request<Investigation>('GET', `/investigations/${id}`),
  applyInvestigation: (id: string) => request<ApplyResult>('POST', `/investigations/${id}/apply`),

  tasks: () => request<Task[]>('GET', '/backlog/tasks'),
  createTask: (t: { title: string; description: string; priority: string; linked_metric_ids: string[] }) =>
    request<Task>('POST', '/backlog/tasks', t),
  patchTask: (id: string, patch: { status?: string; priority?: string }) =>
    request<Task>('PATCH', `/backlog/tasks/${id}`, patch),
  redmine: (id: string) => request<unknown>('GET', `/backlog/tasks/${id}/redmine`),
  backlogRanking: () => request<RankedTask[]>('GET', '/backlog/ranking'),

  hypotheses: () => request<HypothesisRecord[]>('GET', '/hypotheses'),
  measure: (id: string, scenario: 'recovered' | 'not_recovered') =>
    request<Measurement>('POST', `/hypotheses/${id}/measure`, { scenario }),

  settings: () => request<Settings>('GET', '/settings'),
  putMetricRule: (id: string, rule: Partial<MetricRule>) => request<MetricRule>('PUT', `/settings/metrics/${id}`, rule),
  putSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/settings', patch),
  resetSettings: () => request<Settings>('POST', '/settings/reset'),

  search: (q: string, k = 8, source?: string) => request<KnowledgeHit[]>('GET', `/knowledge/search${qs({ q, k, source })}`),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<UploadResult>('POST', '/knowledge/upload', fd)
  },
  reindex: () => request<IndexStats>('POST', '/knowledge/reindex'),

  chat: (message: string, history: ChatMessage[]) => request<ChatResponse>('POST', '/chat', { message, history }),
  metrikaLive: (date1 = '7daysAgo', date2 = 'today') => request<MetrikaLive>('GET', `/metrika/live${qs({ date1, date2 })}`),

  resendEmail: (invId: string) => request<MailSent>('POST', `/investigations/${invId}/send-email`),
  storefrontCard: (family = 'KES') => request<StorefrontCard>('GET', `/storefront/card${qs({ family })}`),

  salesBriefs: () => request<SalesBrief[]>('GET', '/sales-briefs'),
  salesBrief: (id: string) => request<SalesBrief>('GET', `/sales-briefs/${id}`),
  createSalesBrief: (product: string) => request<SalesBrief>('POST', '/sales-briefs', { product }),
  sendSalesBrief: (id: string) => request<MailSent>('POST', `/sales-briefs/${id}/send`),
}

/** Прямая ссылка на CSV для импорта в Redmine (скачивается браузером, в режиме моков — недоступна). */
export const redmineCsvUrl = (aiOnly = true) => `/api/backlog/redmine.csv${aiOnly ? '?ai_only=true' : ''}`

/** Опрос расследования раз в 2 с, пока status = running. */
export async function pollInvestigation(id: string, onTick?: (inv: Investigation) => void, signal?: AbortSignal) {
  for (;;) {
    const inv = await api.investigation(id)
    onTick?.(inv)
    if (inv.status !== 'running') return inv
    await new Promise((r) => setTimeout(r, 2000))
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  }
}
