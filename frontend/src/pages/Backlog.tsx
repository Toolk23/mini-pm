import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Task } from '../api/types'
import { Hl, KIcons, Kicker, Rich, SectionHead } from '../components/highlight'
import { AI_TAG, AiBadge, ErrorBox, Loading, PriorityBadge, fmtDate, useApi } from '../components/ui'

const COLUMNS = [
  { id: 'New', title: 'Новые', tone: 'var(--accent)' },
  { id: 'In Progress', title: 'В работе', tone: 'var(--warm)' },
  { id: 'Reopened', title: 'Переоткрыты', tone: 'var(--danger)' },
  { id: 'Done', title: 'Готово', tone: 'var(--success)' },
] as const
const PRIORITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
const isAi = (t: Task) => t.tags?.includes(AI_TAG)
const touchedByAi = (t: Task) => t.tags?.some((x) => /ИИ-помощник/i.test(x))

export default function Backlog() {
  const tasks = useApi(() => api.tasks())
  const [onlyAi, setOnlyAi] = useState(false)
  const [open, setOpen] = useState<Task | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const list = useMemo(() => (tasks.data ?? []).filter((t) => !onlyAi || touchedByAi(t)), [tasks.data, onlyAi])
  const aiCount = (tasks.data ?? []).filter(isAi).length

  const patch = async (id: string, change: { status?: string; priority?: string }) => {
    const prev = tasks.data
    tasks.setData((prev ?? []).map((t) => (t.task_id === id ? { ...t, ...change } : t)))
    try {
      const upd = await api.patchTask(id, change)
      tasks.setData((cur) => (cur ?? []).map((t) => (t.task_id === id ? upd : t)))
      setOpen((o) => (o?.task_id === id ? upd : o))
    } catch (e) {
      tasks.setData(prev)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const drop = (status: string) => {
    if (drag) {
      const t = tasks.data?.find((x) => x.task_id === drag)
      if (t && t.status !== status) patch(drag, { status })
    }
    setDrag(null)
    setOver(null)
  }

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="violet" icon={<KIcons.bolt />}>Бэклог</Kicker>}
        title={<>Задачи, которые <Hl tone="violet">поставил агент</Hl></>}
        lead={<>Всё, что создал «мини ПМ», помечено тегом <b>«{AI_TAG}»</b>. Задачу можно перетащить между колонками,
          открыть и <b>выгрузить в Redmine</b>.</>}
      />

      <div className="row board-toolbar">
        <div className="segmented">
          <button className={!onlyAi ? 'on' : ''} onClick={() => setOnlyAi(false)}>Все · {tasks.data?.length ?? 0}</button>
          <button className={onlyAi ? 'on' : ''} onClick={() => setOnlyAi(true)}>От ИИ-помощника · {(tasks.data ?? []).filter(touchedByAi).length}</button>
        </div>
        {aiCount === 0 && tasks.data && <span className="faint">Пока ни одной задачи от агента — запусти расследование и нажми «Отправить ПМу».</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={tasks.reload}>Обновить</button>
      </div>

      {err && <ErrorBox error={err} />}
      {tasks.loading && !tasks.data && <Loading />}
      {tasks.error && <ErrorBox error={tasks.error} onRetry={tasks.reload} />}

      {tasks.data && (
        <div className="board">
          {COLUMNS.filter((c) => c.id !== 'Reopened' || list.some((t) => t.status === 'Reopened') || drag).map((col, ci) => {
            const items = list.filter((t) => normStatus(t.status) === col.id)
              .sort((a, b) => Number(isAi(b)) - Number(isAi(a)) || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
            return (
              <section key={col.id} className={`board-col reveal${over === col.id ? ' over' : ''}`} style={{ ['--i' as string]: ci, ['--tone' as string]: col.tone }}
                onDragOver={(e) => { e.preventDefault(); setOver(col.id) }} onDragLeave={() => setOver(null)} onDrop={() => drop(col.id)}>
                <header className="board-col-head">
                  <span className="board-dot" /> {col.title} <span className="faint">{items.length}</span>
                </header>
                <div className="board-items">
                  {items.map((t) => (
                    <article key={t.task_id} className={`task-card${isAi(t) ? ' ai' : ''}${drag === t.task_id ? ' dragging' : ''}`}
                      draggable onDragStart={() => setDrag(t.task_id)} onDragEnd={() => { setDrag(null); setOver(null) }}
                      onClick={() => setOpen(t)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <code className="task-id">{t.task_id}</code>
                        <PriorityBadge p={t.priority} />
                      </div>
                      <div className="task-card-title">{t.title}</div>
                      <div className="row" style={{ gap: 4 }}>
                        {isAi(t) && <AiBadge />}
                        {t.tags?.filter((x) => x !== AI_TAG).map((x) => <span key={x} className="badge badge-ai" style={{ opacity: .75 }}>{x}</span>)}
                        {(t.release_id ?? []).map((r) => <span key={r} className="tok-id">{r}</span>)}
                      </div>
                      {t.linked_metric_ids?.length > 0 && <div className="faint mono task-metrics">{t.linked_metric_ids.join(' · ')}</div>}
                    </article>
                  ))}
                  {items.length === 0 && <div className="board-empty">{drag ? 'Отпусти сюда' : 'Пусто'}</div>}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {open && <TaskDrawer task={open} onClose={() => setOpen(null)} onPatch={(c) => patch(open.task_id, c)} />}
    </>
  )
}

function normStatus(s: string) {
  if (/progress|работ/i.test(s)) return 'In Progress'
  if (/reopen|переоткр/i.test(s)) return 'Reopened'
  if (/done|закрыт|готов/i.test(s)) return 'Done'
  return 'New'
}

/* ---------- карточка задачи + экспорт в Redmine ---------- */
function TaskDrawer({ task, onClose, onPatch }: { task: Task; onClose: () => void; onPatch: (c: { status?: string; priority?: string }) => void }) {
  const redmine = useApi(() => api.redmine(task.task_id), [task.task_id, task.priority, task.title])
  const [copied, setCopied] = useState(false)
  const json = redmine.data ? JSON.stringify(redmine.data, null, 2) : ''

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* нет доступа к буферу */ }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `redmine-${task.task_id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Задача ${task.task_id}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <code className="task-id" style={{ fontSize: 13 }}>{task.task_id}</code>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <h2 className="drawer-title">{task.title}</h2>
        <div className="row" style={{ gap: 6 }}>
          {isAi(task) && <AiBadge />}
          {task.tags?.filter((x) => x !== AI_TAG).map((x) => <span key={x} className="badge badge-ai">{x}</span>)}
          {task.type && <span className="badge">{task.type}</span>}
        </div>

        <div className="grid grid-2" style={{ gap: 10 }}>
          <label className="stack" style={{ gap: 4 }}><span className="stat-label">Статус</span>
            <select value={normStatus(task.status)} onChange={(e) => onPatch({ status: e.target.value })}>
              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}><span className="stat-label">Приоритет</span>
            <select value={task.priority} onChange={(e) => onPatch({ priority: e.target.value })}>
              {['Critical', 'High', 'Medium', 'Low', ...(PRIORITY_ORDER[task.priority] === undefined ? [task.priority] : [])].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <p className="drawer-desc"><Rich text={task.description} /></p>

        <div className="row faint" style={{ gap: 14 }}>
          {task.created_date && <span>создана {fmtDate(task.created_date)}</span>}
          {task.closed_date && <span>закрыта {fmtDate(task.closed_date)}</span>}
          {task.linked_metric_ids?.length > 0 && <span className="mono">{task.linked_metric_ids.join(', ')}</span>}
        </div>

        {task.history?.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">история</span>
            {task.history.slice().reverse().map((h, i) => (
              <div key={i} className="row faint" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="mono" style={{ flex: 'none' }}>{h.at ? new Date(String(h.at)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span>{String(h.event ?? `${h.field}: ${h.from} → ${h.to}`)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="redmine">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row"><span className="redmine-logo">R</span><b>Экспорт в Redmine</b><span className="faint mono">POST /issues.json</span></span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={copy} disabled={!json}>{copied ? 'Скопировано' : 'Копировать'}</button>
              <button className="btn btn-sm" onClick={download} disabled={!json}>Скачать .json</button>
            </span>
          </div>
          {redmine.loading ? <Loading /> : redmine.error ? <ErrorBox error={redmine.error} /> : <pre className="code">{json}</pre>}
        </div>
      </aside>
    </div>
  )
}
