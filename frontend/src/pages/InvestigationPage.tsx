import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, pollInvestigation } from '../api/client'
import type { ApplyResult, CuratedQuote, Investigation, InvestigationReport, InvestigationStep, KnowledgeHit, ReleaseCandidate } from '../api/types'
import { MailStatusLine } from '../components/MailStatus'
import MetricChart from '../components/MetricChart'
import { Radar } from '../components/live'
import { Hl, KIcons, Kicker, Rich } from '../components/highlight'
import { AiBadge, Card, ErrorBox, NoData, NoDataBadge, PriorityBadge, useApi } from '../components/ui'

export default function InvestigationPage() {
  const { id = '' } = useParams()
  const [inv, setInv] = useState<Investigation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setInv(null)
    setError(null)
    pollInvestigation(id, setInv, ctrl.signal).catch((e) => {
      if (e?.name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    })
    return () => ctrl.abort()
  }, [id])

  if (error) return <ErrorBox error={error} />
  if (!inv || inv.status === 'running') return <Working id={id} startedAt={inv?.created_at} />
  if (inv.status === 'error' || !inv.report) return <ErrorBox error={inv.error ?? 'Расследование завершилось с ошибкой'} />
  return <Report inv={inv} rep={inv.report} />
}

/* ================= следователь работает ================= */
const STAGES = [
  'Читаю продажи: средние за периоды и скользящее за 4 недели',
  'Исключаю разовые всплески и помечаю неполную неделю',
  'Сравниваю с контрольной группой — Astra',
  'Проверяю окно релизов: R-07 … R-10',
  'Смотрю воронку: визиты → конфигуратор → корзина',
  'Сверяюсь с реестром разрывов учёта',
  'Ищу подтверждения в интервью и у конкурентов',
  'Собираю отчёт, гипотезы и критерий успеха',
]

function Working({ id, startedAt }: { id: string; startedAt?: string }) {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2200)
    return () => clearInterval(t)
  }, [])
  return (
    <section className="working reveal">
      <div className="working-radar"><Radar size={220} /></div>
      <div className="stack" style={{ gap: 14, minWidth: 0 }}>
        <div className="row eyebrow"><span className="live-dot" /> расследование {id}{startedAt ? ` · начато ${new Date(startedAt).toLocaleTimeString('ru-RU')}` : ''}</div>
        <h1 className="grad-silver" style={{ fontSize: 40 }}>Следователь работает…</h1>
        <p className="muted">Статистику считает детерминированный детектор, модель только интерпретирует факты. Обычно это 20–90 секунд.</p>
        <ol className="stages">
          {STAGES.map((s, i) => (
            <li key={s} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
              <span className="stage-dot">{i < stage ? '✓' : i === stage ? <span className="spinner" /> : ''}</span>{s}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ================= отчёт ================= */
function Report({ inv, rep }: { inv: Investigation; rep: InvestigationReport }) {
  const sig = rep.evidence.signal
  const signals = useApi(() => api.signals())
  const full = signals.data?.find((s) => s.id === inv.signal_id)
  const salesMeta = useApi(() => api.series('family_orders_idx', 'Конфигуратор Kaspersky'))
  const pct = Math.abs(Math.round(sig.change?.change_pct ?? 0))
  const hot = rep.evidence.releases[0] ? [rep.evidence.releases[0].release_id] : []

  return (
    <>
      <header className="inv-head reveal">
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <Link to="/investigations" className="pill-warm" style={{ textDecoration: 'none' }}>
            ‹ Расследование {inv.id}
          </Link>
          <span className="badge" title="llm — отчёт написала модель; template — собран по шаблону из детерминированных фактов">
            {rep.mode.startsWith('llm') ? 'отчёт: LLM' : 'отчёт: шаблон'}
          </span>
        </div>
        <h1 className="inv-title">
          <span className="grad-silver">Почему заказы {sig.family}</span><br />
          <span className="grad-silver">упали на </span><Hl tone="red">{pct}%</Hl>
        </h1>
        {rep.summary && <p className="hero-sub" style={{ margin: '16px auto 0' }}><Rich text={rep.summary} hot={hot} /></p>}
      </header>

      {full?.series && (
        <Card className="reveal" title="Сигнал против контроля" extra={<span className="faint">скользящее за 4 недели · R-09 выделен</span>}>
          <MetricChart name={sig.family ?? ''} points={full.series} height={300}
            control={full.control_series && full.control ? { points: full.control_series, name: full.control.family } : undefined}
            annotations={salesMeta.data?.annotations} gaps={salesMeta.data?.gaps}
            highlightRelease={rep.evidence.releases[0]?.release_id} labelReleases={rep.evidence.releases.map((r) => r.release_id)} />
        </Card>
      )}

      <div className="grid grid-main-side" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          <StepsPicker rep={rep} />
          <Decision inv={inv} rep={rep} />
        </div>

        <aside className="stack inv-aside" style={{ gap: 16 }}>
          <SourcesCheck rep={rep} />
          <Card title={<h2>Пометки учёта</h2>} extra={<span className="faint">{rep.evidence.data_gaps.length}</span>}>
            <div className="stack" style={{ gap: 8 }}>
              {rep.evidence.data_gaps.map((g) => (
                <div key={g.id} className="row faint" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <NoDataBadge label={g.id} /><span>{g.text}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title={<h2>Ловушки кейса</h2>}>
            <ul className="traps">
              {rep.evidence.reference_case_traps.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  )
}

/* ---------- шаги расследования: плитки как у Resend + панель шага ---------- */
type StepKind = 'signal' | 'control' | 'releases' | 'funnel' | 'gap' | 'external' | 'plain' | 'hyp'

function kindOf(s: InvestigationStep): StepKind {
  const t = (s.title ?? '').toLowerCase()
  if (t.includes('релиз')) return 'releases'
  if (t.includes('теряем') || t.includes('воронк')) return 'funnel'
  if (t.includes('пробел') || t.includes('нет данных')) return 'gap'
  if (t.includes('внешн') || t.includes('интервью')) return 'external'
  if (t.includes('контрол')) return 'control'
  if (t.includes('сигнал')) return 'signal'
  return 'plain'
}

const ico = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
const STEP_LOOK: Record<StepKind, { short: string; color: string; icon: ReactNode }> = {
  signal: { short: 'Сигнал', color: '#ff7b7b', icon: ico(<path d="M3 12h4l3-7 4 14 3-7h4" />) },
  control: { short: 'Контроль', color: '#4fe0d4', icon: ico(<><path d="M12 3v18M5 7h14" /><path d="M5 7 2 14a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z" /></>) },
  releases: { short: 'Релизы', color: '#ffb35c', icon: ico(<><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2" /><path d="M9 18 6 15c1-4 4-9 11-11 0 7-5 10-9 11z" /><circle cx="14.5" cy="9.5" r="1.5" /></>) },
  funnel: { short: 'Воронка', color: '#ab9cff', icon: ico(<path d="M3 4h18l-7 8v6l-4 2v-8z" />) },
  gap: { short: 'Нет данных', color: '#a0a4c0', icon: ico(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>) },
  external: { short: 'Источники', color: '#6aa8ff', icon: ico(<path d="M7 7h4v4c0 3-2 5-4 5M14 7h4v4c0 3-2 5-4 5" />) },
  plain: { short: 'Шаг', color: '#c9cbd6', icon: ico(<circle cx="12" cy="12" r="4" />) },
  hyp: { short: 'Гипотезы', color: '#d39bff', icon: ico(<><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" /><path d="M7 15h10" /></>) },
}

function StepsPicker({ rep }: { rep: InvestigationReport }) {
  const items = useMemo(() => [
    ...rep.steps.map((s) => ({ key: `s${s.n}`, kind: kindOf(s), title: s.title ?? `Шаг ${s.n}`, step: s as InvestigationStep | null })),
    { key: 'hyp', kind: 'hyp' as StepKind, title: 'Гипотезы и проверки', step: null as InvestigationStep | null },
  ], [rep])
  const [sel, setSel] = useState(0)
  const [copied, setCopied] = useState(false)
  const cur = items[Math.min(sel, items.length - 1)]
  const look = STEP_LOOK[cur.kind]
  const tilesRef = useRef<HTMLDivElement>(null)

  const go = (i: number) => {
    const n = (i + items.length) % items.length
    setSel(n)
    tilesRef.current?.querySelectorAll<HTMLButtonElement>('.tile')[n]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }
  // Стрелки: от актуального значения, чтобы быстрые нажатия не терялись.
  const shift = (d: number) => setSel((p) => {
    const n = (p + d + items.length) % items.length
    tilesRef.current?.querySelectorAll<HTMLButtonElement>('.tile')[n]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    return n
  })
  const copyText = cur.step
    ? `${cur.title}\n${cur.step.finding}`
    : rep.hypotheses.map((h, i) => `${i + 1}. ${h.text} — проверка: ${h.check ?? ''}`).join('\n')
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyText); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* без буфера */ }
  }

  return (
    <section className="steps-picker reveal">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="stack" style={{ gap: 6 }}>
          <Kicker tone="blue" icon={<KIcons.search />}>Следствие</Kicker>
          <h2 style={{ fontSize: 22, letterSpacing: '-.02em' }}>Ход расследования · {rep.steps.length} шагов</h2>
        </div>
        <span className="faint">← → переключают шаги</span>
      </div>

      <div className="tiles" ref={tilesRef} role="tablist" aria-label="Шаги расследования"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); shift(1) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); shift(-1) }
        }}>
        {items.map((it, i) => {
          const L = STEP_LOOK[it.kind]
          return (
            <button key={it.key} role="tab" aria-selected={i === sel} tabIndex={i === sel ? 0 : -1}
              className={`tile${i === sel ? ' on' : ''}${it.kind === 'gap' ? ' tile-gap' : ''}`} style={{ ['--tc' as string]: L.color }}
              onClick={() => go(i)}>
              <span className="tile-box">{L.icon}{it.step && <span className="tile-n">{it.step.n}</span>}</span>
              <span className="tile-label">{L.short}</span>
            </button>
          )
        })}
      </div>
      <div className="tiles-track"><span style={{ width: `${((sel + 1) / items.length) * 100}%` }} /></div>

      <div className="step-panel" key={cur.key} style={{ ['--tc' as string]: look.color }}>
        <header className="step-panel-head">
          <div className="row" style={{ gap: 6, minWidth: 0 }}>
            <span className="panel-pill on"><span className="panel-pill-ico">{look.icon}</span>{cur.title}</span>
            {cur.step?.sources.map((src, k) => (
              <span key={k} className="panel-pill"><span className="panel-src-dot" />{typeof src === 'string' ? src : src.sheet ?? src.file ?? src.type}</span>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий шаг">‹</button>
            <button className="icon-btn" onClick={() => shift(1)} aria-label="Следующий шаг">›</button>
            <button className="icon-btn" onClick={copy} title="Скопировать текст шага" aria-label="Скопировать">
              {copied ? '✓' : ico(<><rect x="8" y="3" width="10" height="14" rx="2" /><path d="M6 7H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" /></>)}
            </button>
          </div>
        </header>
        <div className="step-panel-body">
          {cur.step ? <StepBody s={cur.step} rep={rep} kind={cur.kind} /> : <HypothesesBody rep={rep} />}
        </div>
      </div>
    </section>
  )
}

function StepBody({ s, rep, kind }: { s: InvestigationStep; rep: InvestigationReport; kind: StepKind }) {
  const hot = rep.evidence.releases[0] ? [rep.evidence.releases[0].release_id] : []
  return (
    <div className="stack" style={{ gap: 12, minWidth: 0 }}>
      {kind === 'releases' ? <Releases list={rep.evidence.releases} /> : kind === 'gap' ? (
        <NoData title="Нет данных — не ноль"><Rich text={s.finding} hot={hot} /></NoData>
      ) : <p className="step-finding"><Rich text={s.finding} hot={hot} /></p>}
      {kind === 'funnel' && <Funnel rep={rep} />}
      {kind === 'gap' && <LinkedTasks rep={rep} />}
      {kind === 'external' && <Quotes rep={rep} stepQuotes={s.quotes} />}
    </div>
  )
}

function Releases({ list }: { list: ReleaseCandidate[] }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.map((r, i) => {
        const main = i === 0
        const score = Math.round((r.score ?? 0) * 100)
        return (
          <div key={r.release_id} className={`cause${main ? ' main' : ''}${score === 0 ? ' dropped' : ''}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row"><code className="cause-id">{r.release_id}</code><span className="faint">{r.date} · {r.type}</span></span>
              <span className="cause-score">{score}%</span>
            </div>
            <div className="cause-bar"><span style={{ width: `${Math.max(score, 2)}%` }} /></div>
            <div className="faint" style={{ color: main ? 'var(--text-2)' : undefined }}><Rich text={r.why ?? ''} /></div>
          </div>
        )
      })}
    </div>
  )
}

const FUNNEL_NAMES: Record<string, string> = {
  cfg_family_views: 'Визиты на страницу семейства', cfg_open: 'Визиты с выбором опций', cfg_reach_rate: 'Доля открывших конфигуратор, %',
  cfg_add_to_cart_rate: 'Добавление в корзину из конфигуратора',
}
function Funnel({ rep }: { rep: InvestigationReport }) {
  const rows = Object.entries(rep.evidence.funnel)
  if (!rows.length) return null
  return (
    <div className="funnel">
      {rows.map(([k, v], i) => (
        <div key={k} className="funnel-row" style={{ ['--w' as string]: `${100 - i * 14}%` }}>
          <span className="funnel-name">{FUNNEL_NAMES[k] ?? k}</span>
          {v.status === 'not_measured' ? <NoDataBadge label="не измеряется" /> : (
            <span className="row" style={{ gap: 6 }}>
              {v.before_mean == null ? <NoDataBadge label="до: нет" /> : <b>{v.before_mean}</b>}
              <span className="faint">→</span><b>{v.after_mean ?? '—'}</b>
            </span>
          )}
          {typeof v.note === 'string' && <span className="funnel-note">{v.note}</span>}
        </div>
      ))}
    </div>
  )
}

function LinkedTasks({ rep }: { rep: InvestigationReport }) {
  const open = rep.evidence.backlog.filter((t) => t.status !== 'Done')
  if (!open.length) return null
  return (
    <div className="stack" style={{ gap: 6 }}>
      {open.map((t) => (
        <div key={t.task_id} className="row mini-task">
          <code>{t.task_id}</code><span>{t.title}</span><PriorityBadge p={t.priority ?? '—'} />
          {rep.raise_tasks?.find((r) => r.task_id === t.task_id) && <span className="badge badge-high">→ поднять до High</span>}
        </div>
      ))}
    </div>
  )
}

function Quotes({ rep, stepQuotes }: { rep: InvestigationReport; stepQuotes?: CuratedQuote[] }) {
  const ae = rep.evidence.analyst_evidence
  const web = rep.evidence.web ?? []
  // Цитаты аналитика: из шага отчёта (steps[n=6].quotes), иначе из сводки evidence.analyst_evidence.
  const curated: CuratedQuote[] = stepQuotes?.length ? stepQuotes : (ae?.items ?? []).map((it) => ({
    id: it.id, title: it.topic, text: it.quote, finding: it.finding, supports_hypothesis: it.supports_hypothesis,
    file: it.source.inner ? `${it.source.inner} (${it.source.file})` : it.source.file, sheet: it.source.sheet, row: it.source.row, curated: true,
  }))
  const [tab, setTab] = useState<'analyst' | 'interview' | 'competitor' | 'web'>(curated.length ? 'analyst' : 'interview')
  const all = tab === 'interview' ? rep.evidence.interviews : tab === 'competitor' ? rep.evidence.competitors : []
  const hits = useMemo(() => dedupe(all).slice(0, 6), [all])
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="segmented" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {curated.length ? <button className={tab === 'analyst' ? 'on' : ''} onClick={() => setTab('analyst')}>Проверено аналитиком · {curated.length}</button> : null}
        <button className={tab === 'interview' ? 'on' : ''} onClick={() => setTab('interview')}>Интервью · {dedupe(rep.evidence.interviews).length}</button>
        <button className={tab === 'competitor' ? 'on' : ''} onClick={() => setTab('competitor')}>Конкуренты · {dedupe(rep.evidence.competitors).length}</button>
        {web.length > 0 && <button className={tab === 'web' ? 'on' : ''} onClick={() => setTab('web')}>Интернет · {web.length}</button>}
      </div>

      {tab === 'analyst' && <AnalystEvidenceView verdict={ae?.verdict} items={curated} />}
      {tab === 'web' && web.map((w) => (
        <figure key={w.url} className="quote">
          <blockquote><b>{w.title}</b>{w.snippet ? <><br />{w.snippet}</> : null}</blockquote>
          <figcaption className="faint mono"><a href={w.url} target="_blank" rel="noreferrer">{w.domain ?? w.url}</a> · Yandex Search API</figcaption>
        </figure>
      ))}
      {(tab === 'interview' || tab === 'competitor') && (hits.length === 0
        ? <NoData title="Не подтверждено внешними источниками">По этой теме в базе ничего не нашлось.</NoData>
        : hits.map((h) => <Quote key={h.id} h={h} />))}
      {tab !== 'analyst' && <p className="faint">Найденные поиском фрагменты — кандидаты в доказательства; вывод о причине по ним делается только вместе с метриками.</p>}
    </div>
  )
}

/** Сводка аналитика: вердикт + цитаты с источником; «нет данных» — отдельным стилем. */
function AnalystEvidenceView({ verdict, items }: { verdict?: string; items: CuratedQuote[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {verdict && (
        <div className="verdict">
          <span className="eyebrow">вывод по внешним источникам</span>
          <p><Rich text={verdict} /></p>
        </div>
      )}
      {items.map((it) => <CuratedCard key={it.id} it={it} />)}
    </div>
  )
}

/** Карточка проверенной цитаты: цитата → вывод аналитика → источник (файл, лист, строка). */
function CuratedCard({ it }: { it: CuratedQuote }) {
  const finding = it.finding ?? ''
  const noData = /^нет данных/i.test(finding)
  return (
    <figure className={`quote ev${noData ? ' ev-nodata' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', marginLeft: 10, marginBottom: 6 }}>
        <span className="row" style={{ gap: 6 }}><code className="tok-id">{it.id}</code>{it.title && <b>{it.title}</b>}</span>
        <span className="row" style={{ gap: 6 }}>
          <span className="badge badge-success">проверено аналитиком</span>
          {noData ? <NoDataBadge label="нет данных" /> : it.supports_hypothesis
            ? <span className="badge badge-high">подтверждает</span> : <span className="badge">не подтверждает падение</span>}
        </span>
      </div>
      <blockquote>{it.text}</blockquote>
      {finding && <div className="ev-finding"><Rich text={finding} /></div>}
      <figcaption className="faint mono">{it.file}{it.sheet ? ` · ${it.sheet}` : ''}{it.row ? ` · строка ${it.row}` : ''}</figcaption>
    </figure>
  )
}

function dedupe(list: KnowledgeHit[]) {
  const seen = new Set<string>()
  return list.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
}

function Quote({ h }: { h: KnowledgeHit }) {
  if (h.curated) return <CuratedCard it={{ ...h, title: h.title, curated: true }} />
  const text = h.text.replace(/^\[[^\]]+\]\s*/, '')
  return (
    <figure className="quote">
      <blockquote>{text.length > 280 ? text.slice(0, 278) + '…' : text}</blockquote>
      <figcaption className="faint mono">{h.file}{h.sheet ? ` · ${h.sheet}` : ''}{h.row ? ` · строка ${h.row}` : ''}</figcaption>
    </figure>
  )
}

/* ---------- проверка по источникам ---------- */
const SRC_NAMES: Record<string, string> = { metrika: 'Метрика и продажи', backlog: 'Бэклог', interviews: 'Интервью', competitors: 'Конкуренты' }
function SourcesCheck({ rep }: { rep: InvestigationReport }) {
  const sc = rep.sources_check
  if (!sc) return null
  return (
    <Card title={<h2>Проверка по источникам</h2>}>
      <div className="stack" style={{ gap: 10 }}>
        {Object.entries(SRC_NAMES).map(([k, name]) => {
          const v = sc[k] ?? 'нет данных'
          const tone = /нет данных|не подтвержд/i.test(v) ? 'nodata' : /частично/i.test(v) ? 'high' : 'success'
          return (
            <div key={k} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span>{name}</span>
              {tone === 'nodata' ? <NoDataBadge label={v} /> : <span className={`badge badge-${tone}`} style={{ whiteSpace: 'normal', height: 'auto', minHeight: 22, textAlign: 'right' }}>{v}</span>}
            </div>
          )
        })}
        {sc.comment && <p className="faint">{sc.comment}</p>}
      </div>
    </Card>
  )
}

/* ---------- гипотезы ---------- */
function HypothesesBody({ rep }: { rep: InvestigationReport }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="step-finding">Что могло сломаться — и как это <Hl tone="violet" sm>проверить</Hl>:</p>
      <div className="grid grid-2">
        {rep.hypotheses.map((h, i) => (
          <div key={i} className="hypo">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">гипотеза {i + 1}</span>
              <span className="badge">{h.status ?? 'не проверена'}</span>
            </div>
            <p className="hypo-text"><Rich text={h.text} /></p>
            {h.check && <p className="faint"><b style={{ color: 'var(--text-2)' }}>Проверка:</b> {h.check}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- решение: рекомендация + действия курьера ---------- */
function Decision({ inv, rep }: { inv: Investigation; rep: InvestigationReport }) {
  const [applied, setApplied] = useState<ApplyResult | null>(inv.applied ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const apply = async () => {
    setBusy(true)
    setErr(null)
    try { setApplied(await api.applyInvestigation(inv.id)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <section className="card decision reveal">
      <Kicker tone="warm" icon={<KIcons.bolt />}>Рекомендация</Kicker>
      <h2 className="decision-text"><Rich text={rep.recommendation} /></h2>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="callout"><div className="stat-label">Критерий успеха</div><div>{rep.success_criterion}</div></div>
        {rep.closing_rule && <div className="callout"><div className="stat-label">Правило закрытия</div><div>{rep.closing_rule}</div></div>}
      </div>

      {rep.task && (
        <div className="task-preview">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">задача в бэклог</span>
            <span className="row"><PriorityBadge p={rep.task.priority} /><AiBadge /></span>
          </div>
          <div className="task-title">{rep.task.title}</div>
          <div className="faint">{rep.task.description}</div>
        </div>
      )}

      {err && <ErrorBox error={err} />}
      {!applied ? (
        <div className="row" style={{ marginTop: 18, gap: 10 }}>
          <button className="btn btn-primary btn-lg" onClick={apply} disabled={busy}>
            {busy ? <><span className="spinner" /> Отправляю…</> : 'Отправить ПМу и создать задачу'}
          </button>
          <span className="faint">письмо + сообщение в Dion · задача с тегом · поднять приоритеты · гипотеза с критерием</span>
        </div>
      ) : (
        <div className="applied reveal">
          <div className="row" style={{ gap: 8 }}><span className="applied-check">✓</span><b>Готово — «мини ПМ» сделал за ПМа:</b></div>
          <ul>
            <li>Письмо ПМу{applied.email.to ? ` (${applied.email.to})` : ''}: «{applied.email.subject}»{applied.email.dion ? ' + сообщение в Dion' : ''}
              <div style={{ marginTop: 4 }}><MailStatusLine invId={inv.id} initial={applied.email.sent} /></div></li>
            <li>Задача <code>{applied.task.task_id}</code> «{applied.task.title}» <AiBadge /></li>
            {applied.raised.map((r) => <li key={r.task_id}>Приоритет <code>{r.task_id}</code> → {r.new_priority}</li>)}
            <li>Гипотеза <code>{applied.hypothesis.id}</code> с критерием успеха — ждёт замера после релиза</li>
          </ul>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn btn-primary" to={`/mail/${inv.id}`}>Открыть письмо</Link>
            <Link className="btn" to="/backlog">В бэклог</Link>
            <Link className="btn btn-ghost" to="/story">К замеру эффекта</Link>
          </div>
        </div>
      )}
    </section>
  )
}
