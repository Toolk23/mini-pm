import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, pollInvestigation } from '../api/client'
import type { HypothesisRecord, Investigation, Measurement, Signal, Task } from '../api/types'
import { Hl, KIcons, Kicker, Rich } from '../components/highlight'
import { CountUp } from '../components/live'
import VerdictChart from '../components/VerdictChart'
import { AiBadge, ErrorBox, Loading, PriorityBadge, useApi } from '../components/ui'

const STAGES = ['Сигнал', 'Расследование', 'Письмо', 'Задача', 'Гипотеза', 'Вердикт'] as const

/**
 * Главный демо-флоу на одном экране:
 * сигнал → расследование → письмо → задача в бэклоге → гипотеза → замер эффекта с вердиктом.
 * Подхватывает уже пройденные шаги с бэкенда (последнее расследование по сигналу KES).
 */
export default function Story() {
  const signals = useApi(() => api.signals())
  const sig = signals.data?.find((s) => s.kind === 'sales_drop')

  const [inv, setInv] = useState<Investigation | null>(null)
  const [restored, setRestored] = useState(false)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hyp, setHyp] = useState<HypothesisRecord | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [raised, setRaised] = useState<Task[]>([])
  const [measure, setMeasure] = useState<Measurement | null>(null)

  // Восстановить прогресс: последнее готовое расследование по этому сигналу.
  useEffect(() => {
    if (!sig || restored) return
    ;(async () => {
      try {
        const list = await api.investigations()
        const mine = list.filter((i) => i.signal_id === sig.id && i.status === 'done')
        const pick = mine.find((i) => i.applied) ?? mine[0]
        if (pick) setInv(await api.investigation(pick.id))
      } catch { /* начнём с нуля */ }
      setRestored(true)
    })()
  }, [sig, restored])

  // Подтянуть живые задачу и гипотезу, когда курьер отработал.
  const syncAfterApply = async (i: Investigation) => {
    if (!i.applied) return
    const [tasks, hyps] = await Promise.all([api.tasks(), api.hypotheses()])
    setTask(tasks.find((t) => t.task_id === i.applied!.task.task_id) ?? i.applied.task)
    setRaised(tasks.filter((t) => i.applied!.raised.some((r) => r.task_id === t.task_id)))
    const h = hyps.find((x) => x.id === i.applied!.hypothesis.id) ?? i.applied.hypothesis
    setHyp(h)
    setMeasure(h.measurement ?? null)
  }
  useEffect(() => { if (inv?.applied) syncAfterApply(inv).catch(() => {}) }, [inv?.id, inv?.applied]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async <T,>(key: string, fn: () => Promise<T>) => {
    setBusy(key); setErr(null)
    try { return await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  const startInvestigation = () => run('inv', async () => {
    if (!sig) return
    setInv(null); setHyp(null); setTask(null); setMeasure(null); setRunning(true)
    const started = await api.startInvestigation(sig.id)
    const done = await pollInvestigation(started.id, (x) => setInv(x))
    setRunning(false)
    setInv(done)
  }).finally(() => setRunning(false))

  const apply = () => run('apply', async () => {
    if (!inv) return
    const a = await api.applyInvestigation(inv.id)
    const next = { ...inv, applied: a }
    setInv(next)
    await syncAfterApply(next)
  })

  const doMeasure = (scenario: 'recovered' | 'not_recovered') => run(scenario, async () => {
    if (!hyp) return
    const m = await api.measure(hyp.id, scenario)
    setMeasure(m)
    const [tasks, hyps] = await Promise.all([api.tasks(), api.hypotheses()])
    setTask(tasks.find((t) => t.task_id === task?.task_id) ?? task)
    setHyp(hyps.find((x) => x.id === hyp.id) ?? hyp)
  })

  const stage = !inv || inv.status !== 'done' ? 0 : !inv.applied ? 1 : !measure ? 4 : 5
  const reached = (i: number) => (i === 0 ? !!sig : i === 1 ? inv?.status === 'done' : i <= 4 ? !!inv?.applied : !!measure)

  // Автопрокрутка к активному шагу.
  const refs = useRef<(HTMLElement | null)[]>([])
  const goTo = (i: number) => refs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const prevStage = useRef(stage)
  useEffect(() => {
    if (stage !== prevStage.current) { const t = setTimeout(() => goTo(Math.min(stage + 1, 5)), 350); prevStage.current = stage; return () => clearTimeout(t) }
  }, [stage])

  return (
    <>
      <header className="story-hero reveal">
        <Kicker tone="green" icon={<KIcons.radar />}>Сквозная история</Kicker>
        <h1 className="hero-title" style={{ fontSize: 'clamp(38px, 5.4vw, 68px)' }}>
          <span className="grad-silver">От сигнала</span><br /><span className="grad-silver">до </span><Hl tone="green">вердикта</Hl>
        </h1>
        <p className="hero-sub lead">
          Один экран — весь цикл продакта: <b>заметить</b>, <b>расследовать</b>, <b>сообщить</b>, <b>поставить задачу</b>,
          <b> сформулировать гипотезу</b> и после релиза <b>проверить эффект</b>. Всё это делает «мини ПМ».
        </p>
      </header>

      <nav className="stepper">
        {STAGES.map((s, i) => (
          <button key={s} className={`step-node${reached(i) ? ' done' : ''}${!reached(i) && (i === 0 || reached(i - 1)) ? ' now' : ''}`} onClick={() => goTo(i)}>
            <span className="step-dot">{reached(i) ? '✓' : i + 1}</span><span className="step-label">{s}</span>
          </button>
        ))}
        <span className="stepper-line"><span style={{ width: `${(Math.max(0, [0, 1, 2, 3, 4, 5].filter(reached).length - 1) / 5) * 100}%` }} /></span>
      </nav>

      {err && <ErrorBox error={err} />}
      {signals.loading && <Loading label="Детектор считает сигналы…" />}

      {sig && (
        <div className="story">
          {/* 1. Сигнал */}
          <StoryStep n={1} kicker={<Kicker tone="red" icon={<KIcons.pulse />}>Сигнал</Kicker>} state="done" refEl={(el) => (refs.current[0] = el)}
            title={<><Rich text={sig.title} /></>}>
            <SignalMini s={sig} />
          </StoryStep>

          {/* 2. Расследование */}
          <StoryStep n={2} kicker={<Kicker tone="blue" icon={<KIcons.search />}>Расследование</Kicker>} refEl={(el) => (refs.current[1] = el)}
            state={inv?.status === 'done' ? 'done' : 'now'}
            title={inv?.report?.summary ? <Rich text={inv.report.summary} hot={inv.report.evidence.releases[0] ? [inv.report.evidence.releases[0].release_id] : []} /> : 'Агент проверяет сигнал по всем источникам'}
            action={inv?.status === 'done' ? <Link className="btn btn-sm btn-ghost" to={`/investigations/${inv.id}`}>Полный отчёт</Link> : null}>
            {!inv && !running && restored && (
              <button className="btn btn-primary btn-lg" onClick={startInvestigation} disabled={!!busy}>Запустить расследование</button>
            )}
            {(running || inv?.status === 'running') && <div className="row muted"><span className="spinner" /> Следователь собирает доказательства: продажи, контроль, релизы, воронка, реестр разрывов, интервью…</div>}
            {inv?.status === 'done' && inv.report && <InvMini inv={inv} />}
          </StoryStep>

          {/* 3. Письмо */}
          <StoryStep n={3} kicker={<Kicker tone="warm" icon={<KIcons.send />}>Письмо ПМу</Kicker>} refEl={(el) => (refs.current[2] = el)}
            state={inv?.applied ? 'done' : inv?.status === 'done' ? 'now' : 'locked'}
            title={inv?.applied ? <Rich text={inv.applied.email.subject} /> : 'Отчёт уходит продакту письмом и в Dion'}
            action={inv?.applied ? <Link className="btn btn-sm btn-ghost" to={`/mail/${inv.id}`}>Открыть письмо</Link> : null}>
            {inv?.status === 'done' && !inv.applied && (
              <button className="btn btn-primary btn-lg" onClick={apply} disabled={!!busy}>
                {busy === 'apply' ? <><span className="spinner" /> Отправляю…</> : 'Отправить ПМу и создать задачу'}
              </button>
            )}
            {inv?.applied && (
              <div className="grid grid-2">
                <div className="mini-mail">
                  <div className="row faint"><span className="mail-avatar sm">ПМ</span> мини ПМ → продакт-менеджер</div>
                  <p className="muted" style={{ whiteSpace: 'pre-line' }}><Rich text={inv.applied.email.body.split('\n').slice(0, 4).join('\n')} /></p>
                </div>
                {inv.applied.email.dion && (
                  <div className="mini-mail dion-mini">
                    <div className="row faint"><span className="dion-logo">D</span> Dion · # мини ПМ</div>
                    <p className="muted" style={{ whiteSpace: 'pre-line' }}><Rich text={inv.applied.email.dion.text} /></p>
                  </div>
                )}
              </div>
            )}
          </StoryStep>

          {/* 4. Задача */}
          <StoryStep n={4} kicker={<Kicker tone="violet" icon={<KIcons.bolt />}>Задача в бэклоге</Kicker>} refEl={(el) => (refs.current[3] = el)}
            state={task ? 'done' : 'locked'} title={task ? task.title : 'Задача с тегом «сгенерирована ИИ-помощником»'}
            action={task ? <Link className="btn btn-sm btn-ghost" to="/backlog">В бэклог</Link> : null}>
            {task && (
              <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
                <div className="task-card ai" style={{ cursor: 'default', flex: '1 1 320px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <code className="task-id">{task.task_id}</code>
                    <span className="row"><span className={`badge ${task.status === 'Done' ? 'badge-success' : task.status === 'Reopened' ? 'badge-critical' : ''}`}>{task.status}</span><PriorityBadge p={task.priority} /></span>
                  </div>
                  <div className="task-card-title">{task.title}</div>
                  <div className="row"><AiBadge /></div>
                </div>
                {raised.map((r) => (
                  <div key={r.task_id} className="task-card" style={{ cursor: 'default', flex: '1 1 240px' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}><code className="task-id">{r.task_id}</code><span className="badge badge-high">приоритет → {r.priority}</span></div>
                    <div className="task-card-title">{r.title}</div>
                    <div className="faint">без событий корзины нельзя локализовать потерю</div>
                  </div>
                ))}
              </div>
            )}
          </StoryStep>

          {/* 5. Гипотеза */}
          <StoryStep n={5} kicker={<Kicker tone="violet" icon={<KIcons.flask />}>Гипотеза</Kicker>} refEl={(el) => (refs.current[4] = el)}
            state={hyp ? 'done' : 'locked'} title={hyp ? hyp.text : 'Гипотеза с критерием успеха и контрольной группой'}>
            {hyp && (
              <div className="grid grid-3">
                <div className="callout"><div className="stat-label">Критерий успеха</div><div><Rich text={hyp.target ?? ''} /></div></div>
                <div className="callout"><div className="stat-label">Порог</div><div>скользящее за 4 недели не ниже базы на <b>{Math.abs(hyp.success_threshold_pct ?? 10)}%</b></div></div>
                <div className="callout"><div className="stat-label">Контроль</div><div><b>{hyp.control_family ?? 'Astra'}</b> — должна остаться стабильной</div></div>
              </div>
            )}
          </StoryStep>

          {/* 6. Вердикт */}
          <StoryStep n={6} kicker={<Kicker tone="teal" icon={<KIcons.pulse />}>Замер эффекта</Kicker>} refEl={(el) => (refs.current[5] = el)} last
            state={measure ? 'done' : hyp ? 'now' : 'locked'}
            title={measure ? <Verdict m={measure} task={task} /> : 'После хотфикса агент сам сравнивает «до / после»'}>
            {hyp && (
              <div className="stack" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="faint">Данные «после хотфикса» — синтетика для демо:</span>
                  <button className={`btn ${measure?.scenario === 'recovered' ? 'btn-primary' : ''}`} onClick={() => doMeasure('recovered')} disabled={!!busy}>
                    {busy === 'recovered' && <span className="spinner" />} Индекс вернулся
                  </button>
                  <button className={`btn ${measure?.scenario === 'not_recovered' ? 'btn-primary' : ''}`} onClick={() => doMeasure('not_recovered')} disabled={!!busy}>
                    {busy === 'not_recovered' && <span className="spinner" />} Не вернулся
                  </button>
                </div>
                {measure && sig.series && (
                  <>
                    <div className="grid grid-3">
                      <Stat label="База (до падения)" value={measure.baseline_mean ?? 0} digits={1} />
                      <Stat label="После хотфикса, скользящее 4 нед." value={measure.after_rolling_4w} digits={1}
                        sub={measure.change_vs_baseline_pct != null ? `${measure.change_vs_baseline_pct > 0 ? '+' : ''}${measure.change_vs_baseline_pct}% к базе` : undefined}
                        tone={measure.verdict === 'confirmed' ? 'up' : 'down'} />
                      <Stat label={`Контроль ${measure.control.family}`} value={measure.control.change_pct ?? 0} digits={1} suffix="%" signed
                        sub={measure.control.stable ? 'стабилен' : 'нестабилен — вывод осторожно'} />
                    </div>
                    <VerdictChart history={sig.series.slice(-14)} control={sig.control_series?.slice(-14)} m={measure} thresholdPct={hyp.success_threshold_pct ?? -10} />
                    <p className="muted"><Rich text={measure.decision} /></p>
                  </>
                )}
              </div>
            )}
          </StoryStep>
        </div>
      )}

      {inv?.status === 'done' && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={startInvestigation} disabled={!!busy}>Пройти историю заново</button>
        </div>
      )}
    </>
  )
}

/* ---------- части ---------- */
function StoryStep({ n, kicker, title, state, action, children, refEl, last }:
  { n: number; kicker: ReactNode; title: ReactNode; state: 'done' | 'now' | 'locked'; action?: ReactNode; children?: ReactNode; refEl: (el: HTMLElement | null) => void; last?: boolean }) {
  return (
    <section ref={refEl} className={`story-step ${state}${last ? ' last' : ''}`}>
      <div className="story-rail"><span className="story-num">{state === 'done' ? '✓' : n}</span></div>
      <div className="card story-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>{kicker}{action}</div>
        <h2 className="story-title">{title}</h2>
        {state !== 'locked' && children && <div className="story-body">{children}</div>}
        {state === 'locked' && <div className="faint">Откроется после предыдущего шага</div>}
      </div>
    </section>
  )
}

function SignalMini({ s }: { s: Signal }) {
  return (
    <div className="grid grid-3">
      <Stat label={`Заказы ${s.family} к базе`} value={s.change?.change_pct ?? 0} suffix="%" tone="down"
        sub={`${Math.round(s.change?.baseline_mean ?? 0)} → ${Math.round(s.change?.post_mean ?? 0)}`} />
      <Stat label={`Контроль ${s.control?.family ?? ''}`} value={s.control?.change_pct ?? 0} suffix="%" signed digits={0}
        sub={s.control?.stable ? 'стабилен — падение специфично' : 'контроль изменился'} />
      <div className="callout stack" style={{ gap: 6 }}>
        <div className="stat-label">Оговорки детектора</div>
        {s.caveats.filter((c) => /всплеск|неполн/i.test(c)).map((c) => <div key={c} className="faint">• {c.split(':')[0]}</div>)}
      </div>
    </div>
  )
}

function InvMini({ inv }: { inv: Investigation }) {
  const rep = inv.report!
  const top = rep.evidence.releases[0]
  const counts = useMemo(() => ({
    steps: rep.steps.length, gaps: rep.evidence.data_gaps.length,
    quotes: rep.evidence.analyst_evidence?.items?.length ?? rep.evidence.interviews.length,
  }), [rep])
  return (
    <div className="stack" style={{ gap: 12 }}>
      {top && (
        <div className="cause main">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row"><code className="cause-id">{top.release_id}</code><span className="faint">главный кандидат · {top.date}</span></span>
            <span className="cause-score">{Math.round((top.score ?? 0) * 100)}%</span>
          </div>
          <div className="cause-bar"><span style={{ width: `${Math.round((top.score ?? 0) * 100)}%` }} /></div>
          <div className="faint" style={{ color: 'var(--text-2)' }}><Rich text={top.why ?? ''} /></div>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <span className="chip">{counts.steps} шагов следствия</span>
        <span className="chip">{counts.quotes} цитат из внешних источников</span>
        <span className="chip">{counts.gaps} пометок учёта</span>
        <span className="chip">{rep.hypotheses.length} гипотезы</span>
      </div>
    </div>
  )
}

function Verdict({ m, task }: { m: Measurement; task: Task | null }) {
  const ok = m.verdict === 'confirmed'
  return (
    <span className={`verdict-title ${ok ? 'ok' : 'bad'}`}>
      <span>{ok ? <>Гипотеза <Hl tone="green">подтверждена</Hl></> : <>Гипотеза <Hl tone="red">не подтверждена</Hl></>}</span>
      <span className="verdict-sub">{ok ? `задача ${task?.task_id ?? ''} закрыта` : `задача ${task?.task_id ?? ''} переоткрыта, гипотеза пересматривается`}</span>
    </span>
  )
}

function Stat({ label, value, digits = 0, suffix = '', signed = false, sub, tone }:
  { label: string; value: number; digits?: number; suffix?: string; signed?: boolean; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="callout">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`} style={{ fontSize: 34 }}><CountUp value={value} digits={digits} suffix={suffix} signed={signed} /></div>
      {sub && <div className="faint">{sub}</div>}
    </div>
  )
}
