// Типы по docs/api.md (реальные ответы бэкенда). Необязательные поля — то, что бывает не у всех сигналов/режимов.

export interface SeriesPoint {
  week_start: string
  value: number | null
  rolling: number | null
  spike: boolean
  incomplete: boolean
  comment: string | null
}

export interface ReleaseCandidate {
  release_id: string
  date: string
  type: string
  description: string
  affected_metrics: string[]
  related_task_ids: string[]
  score?: number
  why?: string
}

export interface ControlGroup {
  family: string
  name: string
  baseline_mean: number
  post_mean: number
  change_pct: number
  baseline_period: string
  post_period: string
  stable: boolean
  conclusion: string
}

export interface Signal {
  id: string
  kind: 'sales_drop' | 'zero_weeks' | string
  metric_id: string
  product: string
  family?: string
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | string
  title: string
  change?: {
    baseline_mean: number
    post_mean: number
    change_pct: number
    baseline_period: string
    post_period: string
    baseline_weeks: number
    post_weeks: number
  }
  split_week?: string
  rolling?: { before: number; after_min: number; after_last: number }
  threshold_pct?: number
  control?: ControlGroup
  release_candidates?: ReleaseCandidate[]
  facts?: Record<string, unknown>
  caveats: string[]
  series?: SeriesPoint[]
  control_series?: SeriesPoint[]
}

export interface Annotation {
  type: 'release' | string
  id: string
  date: string
  label: string
  description: string
  affects_metric: boolean
}

export interface DataGap {
  id: string
  scope: string
  until?: string
  from?: string
  to?: string
  last_week?: boolean
  text: string
}

export interface MetricSeries {
  metric_id: string
  product: string
  points: SeriesPoint[]
  annotations: Annotation[]
  gaps: DataGap[]
}

export interface MetricRule {
  enabled: boolean
  rule: 'pct_drop' | 'pp_drop' | 'pct_rise' | 'zero_week' | string
  threshold: number
  priority: string
}

export interface MetricInfo {
  metric_id: string
  metric_name: string
  what_it_means: string
  formula_or_logic: string
  source: string
  segment: string
  target_value: string
  bad_signal: string
  priority_impact: string
  comment: string
  rule?: MetricRule
}

export interface Release {
  release_id: string
  release_date: string
  release_type: string
  description: string
  related_task_ids: string[]
  affected_metrics: string[]
  status: string
}

export interface InvestigationStep {
  n: number
  title?: string
  finding: string
  sources: (string | { type?: string; sheet?: string; file?: string; quote?: string })[]
}

export interface Hypothesis {
  text: string
  check?: string
  status?: string
}

export interface KnowledgeHit {
  id: string
  source_type: 'interview' | 'competitor' | 'upload' | string
  file: string
  sheet?: string
  row?: number
  title: string
  text: string
  score: number
  meta?: Record<string, unknown>
}

export interface InvestigationReport {
  id: string
  mode: string
  created_at: string
  summary?: string
  steps: InvestigationStep[]
  hypotheses: Hypothesis[]
  sources_check?: Record<string, string>
  recommendation: string
  task?: { title: string; description: string; priority: string }
  raise_tasks?: { task_id: string; new_priority: string; why?: string }[]
  success_criterion: string
  closing_rule?: string
  email?: { subject: string; body: string }
  evidence: {
    signal: Partial<Signal>
    releases: ReleaseCandidate[]
    funnel: Record<string, { status?: string; before_mean?: number; after_mean?: number; [k: string]: unknown }>
    backlog: Partial<Task>[]
    data_gaps: DataGap[]
    interviews: KnowledgeHit[]
    competitors: KnowledgeHit[]
    /** Сводка аналитика по внешним источникам (data/curated/evidence_kaspersky.json) */
    analyst_evidence?: AnalystEvidence | null
    /** Результаты Yandex Search API */
    web?: { url: string; domain?: string; title?: string; snippet?: string }[]
    reference_case_traps: string[]
  }
}

export interface AnalystEvidence {
  question: string
  verdict: string
  items: {
    id: string
    topic: string
    supports_hypothesis: boolean
    source: { file: string; sheet?: string; row?: number; inner?: string }
    quote: string
    finding: string
  }[]
}

export interface Investigation {
  id: string
  status: 'running' | 'done' | 'error'
  signal_id: string
  created_at: string
  error?: string
  report?: InvestigationReport
  applied?: ApplyResult
}

export interface ApplyResult {
  task: Task
  raised: { task_id: string; new_priority: string }[]
  hypothesis: HypothesisRecord
  email: {
    subject: string
    body: string
    html?: string
    eml_path?: string
    to?: string
    dion?: { channel: string; text: string }
  }
}

export interface Task {
  task_id: string
  title: string
  type?: string
  status: string
  priority: string
  created_date?: string
  closed_date?: string | null
  release_id?: string[]
  description: string
  linked_metric_ids: string[]
  source?: string[]
  tags: string[]
  history: { at?: string; field?: string; from?: string; to?: string; [k: string]: unknown }[]
}

export interface Measurement {
  synthetic: boolean
  scenario: 'recovered' | 'not_recovered' | string
  weeks: { week_start: string; value: number; control: number }[]
  baseline_mean: number | null
  before_fix_mean: number | null
  after_rolling_4w: number
  change_vs_baseline_pct: number | null
  control: { family: string; baseline_mean: number | null; after_rolling_4w: number; change_pct: number | null; stable: boolean }
  verdict: 'confirmed' | 'rejected' | string
  decision: string
}

export interface HypothesisRecord {
  id: string
  status: string
  created_at?: string
  investigation_id?: string | null
  text: string
  metric_id?: string
  family?: string
  control_family?: string
  target?: string
  success_threshold_pct?: number
  task_id?: string | null
  measurement?: Measurement
}

export interface Settings {
  detector: Record<string, number>
  sources_weights: Record<string, number>
  metrics: Record<string, MetricRule>
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  answer: string
  sources: KnowledgeHit[]
  facts?: { signals_detailed?: unknown[]; other_signals?: { id: string; title: string; priority: string }[] }
  mode: 'llm' | 'search_only' | string
}

export interface Health {
  ok: boolean
  data: Record<string, number>
  llm: { configured: boolean; provider: string; model: string }
  metrika: { configured: boolean }
}

export interface MetrikaLive {
  ok: boolean
  error?: string
  status?: number
  source?: string
  counter_id?: string
  request?: { url: string; params: Record<string, string | number> }
  totals?: Record<string, number>
  rows?: { date: string; visits?: number; users?: number; [k: string]: string | number | undefined }[]
}
