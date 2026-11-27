import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { IndexStats, KnowledgeHit, UploadResult } from '../api/types'
import { Hl, KIcons, Kicker, SectionHead } from '../components/highlight'
import { CountUp } from '../components/live'
import { ErrorBox, NoData } from '../components/ui'

const ACCEPT = '.xlsx,.csv,.tsv,.txt,.md,.docx'
const SOURCE_TABS = [
  { id: '', label: 'Все' }, { id: 'interview', label: 'Интервью' }, { id: 'competitor', label: 'Конкуренты' }, { id: 'upload', label: 'Загруженные' },
]
const SOURCE_RU: Record<string, string> = { interview: 'Интервью', competitor: 'Конкуренты', upload: 'Загружено' }
const DEMO_FILE = '/demo/demo-interview-kes.md'

export default function Knowledge() {
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadResult[]>([])
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [lastQ, setLastQ] = useState('')

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setBusy('upload'); setErr(null)
    try {
      for (const f of list) {
        const r = await api.upload(f)
        setUploads((u) => [r, ...u.filter((x) => x.file !== r.file)])
      }
      // Файл индексируется сразу при загрузке — полная переиндексация не нужна (она долгая и блокирует поиск).
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const uploadDemo = async () => {
    setBusy('upload'); setErr(null)
    try {
      const blob = await (await fetch(DEMO_FILE)).blob()
      await upload([new File([blob], 'demo-interview-kes.md', { type: 'text/markdown' })])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null) }
  }
  const reindex = async () => {
    setBusy('reindex'); setErr(null)
    try { setStats(await api.reindex()) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const search = async (query = q, source = src) => {
    if (!query.trim()) return
    setBusy('search'); setErr(null); setLastQ(query)
    try { setHits(await api.search(query, 8, source || undefined)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files) }

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="blue" icon={<KIcons.search />}>Закрытый контур</Kicker>}
        title={<>База знаний <Hl tone="violet">растёт</Hl> вместе с вами</>}
        lead={<>Интервью, конкурентный анализ и новые исследования. Загружаете файл — он <b>сразу попадает в индекс</b>,
          и агент <b>цитирует его</b> в расследованиях и чате. Данные остаются <b>внутри стенда</b>, поиск локальный (BM25).</>}
      />
      {err && <ErrorBox error={err} />}

      <div className="grid grid-main-side" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          {/* загрузка */}
          <section className={`dropzone reveal${drag ? ' drag' : ''}${busy === 'upload' ? ' busy' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
            <div className="drop-icon">{busy === 'upload' ? <span className="spinner" style={{ width: 26, height: 26 }} /> :
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>}</div>
            <div className="drop-title">{busy === 'upload' ? 'Разбираю файл на фрагменты и обновляю индекс…' : drag ? 'Отпустите — загружу' : 'Перетащите новое исследование сюда'}</div>
            <div className="faint">или нажмите, чтобы выбрать · xlsx, csv, txt, md, docx</div>
          </section>
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-sm btn-ghost" onClick={uploadDemo} disabled={!!busy}>Загрузить демо-интервью</button>
            <span className="faint">синтетический файл для показа — не данные заказчика</span>
          </div>

          {uploads.map((u) => (
            <section key={u.file} className={`upload-result reveal${u.error ? ' bad' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="applied-check" style={u.error ? { background: 'var(--danger)' } : undefined}>{u.error ? '!' : '✓'}</span>
                  <span className="stack" style={{ gap: 2 }}>
                    <b>{u.file}</b>
                    <span className="faint">{u.error ? u.error : <>в индексе <b style={{ color: 'var(--text)' }}>{u.chunks_added}</b> новых фрагментов — агент уже может их цитировать</>}</span>
                  </span>
                </span>
                {!u.error && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => { setSrc('upload'); setQ('продление счёт менеджер'); search('продление счёт менеджер', 'upload') }}>Найти в файле</button>
                    <button className="btn btn-sm btn-primary" onClick={() => nav('/chat', { state: { ask: 'Как клиенты продлевают Kaspersky?' } })}>Спросить в чате</button>
                  </span>
                )}
              </div>
            </section>
          ))}

          {/* поиск */}
          <section className="card reveal">
            <form className="search-bar" onSubmit={(e) => { e.preventDefault(); search() }}>
              <KIcons.search />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по базе: «счёт», «allsoft цена», «конфигуратор»…" />
              <button className="btn btn-primary btn-sm" disabled={busy === 'search' || !q.trim()}>{busy === 'search' ? <span className="spinner" /> : 'Найти'}</button>
            </form>
            <div className="segmented" style={{ marginTop: 12 }}>
              {SOURCE_TABS.map((t) => (
                <button key={t.id} className={src === t.id ? 'on' : ''} onClick={() => { setSrc(t.id); if (lastQ) search(lastQ, t.id) }}>{t.label}</button>
              ))}
            </div>
            {hits && (
              <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                {hits.length === 0 ? <NoData title="Нет данных">По запросу «{lastQ}» в базе ничего не нашлось — агент так и ответит, а не выдумает.</NoData> :
                  hits.map((h, i) => <Hit key={h.id + i} h={h} q={lastQ} max={hits[0].score} />)}
              </div>
            )}
          </section>
        </div>

        <aside className="inv-aside stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head"><h2>Индекс</h2>
              <button className="btn btn-sm" onClick={reindex} disabled={!!busy}>{busy === 'reindex' ? <><span className="spinner" /> Переобучаю ~10 с…</> : 'Переобучить'}</button>
            </div>
            {stats ? (
              <div className="stack" style={{ gap: 12 }}>
                <div className="live-count"><CountUp value={stats.chunks} /><span>фрагментов</span></div>
                {Object.entries(stats.by_source).map(([k, n]) => (
                  <div key={k} className="weight">
                    <span>{SOURCE_RU[k] ?? k}</span>
                    <span className="weight-bar"><span style={{ width: `${(n / stats.chunks) * 100}%` }} /></span>
                    <b className="mono">{n}</b>
                  </div>
                ))}
                {stats.seconds != null && <span className="faint">собран за {stats.seconds} с · без внешних эмбеддингов</span>}
                {stats.errors?.map((e) => <span key={e} className="faint" style={{ color: 'var(--danger)' }}>{e}</span>)}
              </div>
            ) : <p className="faint">Нажмите «Переобучить», чтобы пересобрать индекс и увидеть, сколько фрагментов в каждом источнике.</p>}
          </section>
          <section className="card">
            <h2 style={{ marginBottom: 10 }}>Что внутри</h2>
            <ul className="traps known">
              <li>Транскрибации интервью: когорты, отток, сервисные преимущества</li>
              <li>Конкурентное исследование: цены, поисковый спрос, allsoft и другие</li>
              <li>Загруженные исследования — сразу после загрузки</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}

function Hit({ h, q, max }: { h: KnowledgeHit; q: string; max: number }) {
  const text = h.text.replace(/^\[[^\]]+\]\s*/, '')
  return (
    <figure className="quote hit">
      <div className="row" style={{ justifyContent: 'space-between', marginLeft: 10, marginBottom: 6 }}>
        <span className="row" style={{ gap: 6 }}><span className={`badge${h.source_type === 'upload' ? ' badge-ai' : ''}`}>{SOURCE_RU[h.source_type] ?? h.source_type}</span><b className="hit-title">{h.title}</b></span>
        <span className="hit-score"><span style={{ width: `${Math.max(8, (h.score / (max || 1)) * 100)}%` }} /></span>
      </div>
      <blockquote><Mark text={text.length > 320 ? text.slice(0, 318) + '…' : text} q={q} /></blockquote>
      <figcaption className="faint mono">{h.file}{h.sheet ? ` · ${h.sheet}` : ''}{h.row ? ` · строка ${h.row}` : ''}</figcaption>
    </figure>
  )
}

/** Подсветка слов запроса (по основе слова, без морфологии — первые 5 букв). */
function Mark({ text, q }: { text: string; q: string }) {
  const stems = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.min(5, w.length)))
  if (!stems.length) return <>{text}</>
  const re = new RegExp(`(${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}]*`, 'giu')
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index))
    out.push(<mark key={m.index} className="q-mark">{m[0]}</mark>)
    last = (m.index ?? 0) + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}
