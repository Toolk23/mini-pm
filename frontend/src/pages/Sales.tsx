import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { CuratedQuote, MailSent, SalesBrief } from '../api/types'
import { Hl, KIcons, Kicker, Rich, SectionHead } from '../components/highlight'
import StoreCard from '../components/StoreCard'
import { MailStatus } from '../components/MailStatus'
import { AiBadge, ErrorBox, Loading, useApi } from '../components/ui'

const PRODUCTS = [{ id: 'KES', label: 'Kaspersky' }, { id: 'Astra', label: 'Astra Linux' }]
const STAGES = ['Читаю конкурентный анализ', 'Ищу в интервью, что говорят клиенты', 'Сверяю с цитатами аналитика',
  'Открываю карточку товара на store.softline.ru', 'Смотрю сигналы и релизы по продукту', 'Пишу аргументы, FAQ и возражения']

export default function Sales() {
  const list = useApi(() => api.salesBriefs())
  const [product, setProduct] = useState('KES')
  const [selId, setSelId] = useState<string | null>(null)
  const [brief, setBrief] = useState<SalesBrief | null>(null)
  const [loadingOne, setLoadingOne] = useState(false)
  const [building, setBuilding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Открыть последнюю справку по умолчанию.
  useEffect(() => { if (!selId && list.data?.length) setSelId(list.data[0].id) }, [list.data, selId])
  useEffect(() => {
    if (!selId) return
    if (brief?.id === selId) return
    setLoadingOne(true)
    api.salesBrief(selId).then(setBrief).catch((e) => setErr(String(e?.message ?? e))).finally(() => setLoadingOne(false))
  }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps

  const build = async () => {
    setBuilding(true); setErr(null)
    try {
      const b = await api.createSalesBrief(product)
      setBrief(b); setSelId(b.id)
      list.reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBuilding(false) }
  }

  return (
    <>
      <SectionHead
        kicker={<Kicker tone="warm" icon={<KIcons.send />}>Продажам</Kicker>}
        title={<>Справка для продавцов <Hl tone="warm">с источниками</Hl></>}
        lead={<>ПМ тратит часы на одни и те же объяснения отделу продаж. Агент собирает шпаргалку по продукту из
          <b> конкурентного анализа</b>, <b>интервью</b>, <b>карточки товара</b> и сигналов — у каждого тезиса есть ссылка на источник.</>}
      />
      {err && <ErrorBox error={err} />}

      <section className="card sales-bar reveal">
        <div className="row" style={{ gap: 12 }}>
          <span className="stat-label">Продукт</span>
          <div className="segmented">
            {PRODUCTS.map((p) => <button key={p.id} className={product === p.id ? 'on' : ''} onClick={() => setProduct(p.id)} disabled={building}>{p.label}</button>)}
          </div>
        </div>
        <button className="btn btn-primary" onClick={build} disabled={building}>{building ? <><span className="spinner" /> Собираю…</> : 'Собрать справку'}</button>
      </section>

      {building && <Building product={PRODUCTS.find((p) => p.id === product)?.label ?? product} />}

      <div className="sales-layout">
        <aside className="stack sales-list" style={{ gap: 6 }}>
          <div className="eyebrow" style={{ padding: '0 4px 4px' }}>справки · {list.data?.length ?? 0}</div>
          {list.loading && !list.data && <Loading />}
          {list.data?.length === 0 && !building && <div className="board-empty">Пока нет ни одной справки — соберите первую</div>}
          {list.data?.map((b) => (
            <button key={b.id} className={`mail-item${b.id === selId ? ' on' : ''}`} onClick={() => setSelId(b.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{b.family ?? b.product}</b><span className="faint">{fmt(b.created_at)}</span></div>
              <div className="mail-item-subj">{b.product}</div>
              <div className="faint mono">{b.id} · {b.mode === 'llm' ? 'LLM' : 'шаблон'}</div>
            </button>
          ))}
        </aside>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {loadingOne && <Loading label="Открываю справку…" />}
          {brief && !loadingOne && <BriefView b={brief} />}
        </div>
      </div>
    </>
  )
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

/* ---------- ожидание 40–80 секунд ---------- */
function Building({ product }: { product: string }) {
  const [sec, setSec] = useState(0)
  const t0 = useRef(Date.now())
  useEffect(() => { const t = setInterval(() => setSec(Math.round((Date.now() - t0.current) / 1000)), 500); return () => clearInterval(t) }, [])
  const stage = Math.min(STAGES.length - 1, Math.floor(sec / 9))
  return (
    <section className="card building reveal">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="row" style={{ gap: 10 }}><span className="spinner" /> Агент собирает справку по {product}: конкуренты, интервью, карточка товара…</b>
        <span className="mono faint">{sec} с · обычно 40–80 с</span>
      </div>
      <ol className="stages" style={{ marginTop: 12 }}>
        {STAGES.map((s, i) => (
          <li key={s} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
            <span className="stage-dot">{i < stage ? '✓' : i === stage ? <span className="spinner" /> : ''}</span>{s}
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ---------- сама справка ---------- */
function BriefView({ b }: { b: SalesBrief }) {
  const quotes = useMemo(() => Object.fromEntries((b.evidence?.analyst_quotes ?? []).map((q) => [q.id, q])), [b]) as Record<string, CuratedQuote>
  const src = (s?: string) => <SourceRef s={s} quotes={quotes} />
  const card = b.evidence?.store_card
  return (
    <>
      <section className="card brief-head reveal">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <span className="row" style={{ gap: 8 }}><AiBadge /><span className="badge">{b.mode === 'llm' ? 'LLM' : 'шаблон без LLM'}</span><span className="faint mono">{b.id} · {fmt(b.created_at)}</span></span>
            <h2 className="brief-title">{b.product}</h2>
          </div>
          <SendBlock id={b.id} initial={b.sent} />
        </div>
        {b.pitch && <p className="brief-pitch"><Rich text={b.pitch} /></p>}
      </section>

      <div className="grid grid-2">
        {!!b.who_buys?.length && (
          <section className="card reveal">
            <div className="eyebrow">кто покупает</div>
            <ul className="brief-ul">{b.who_buys.map((w, i) => <li key={i}>{clip(clean(w), 220)}</li>)}</ul>
          </section>
        )}
        {!!b.dont_say?.length && (
          <section className="card dont-say reveal">
            <div className="dont-say-title">Что нельзя обещать</div>
            <ul className="brief-ul">{b.dont_say.map((d, i) => <li key={i}><Rich text={d} /></li>)}</ul>
          </section>
        )}
      </div>

      {!!b.key_points?.length && (
        <section className="card reveal">
          <div className="eyebrow" style={{ marginBottom: 10 }}>аргументы</div>
          <div className="grid grid-2" style={{ gap: 10 }}>
            {b.key_points.map((k, i) => (
              <div key={i} className="point"><p><Rich text={k.text} /></p>{src(k.source)}</div>
            ))}
          </div>
        </section>
      )}

      {!!b.vs_competitors?.length && (
        <section className="card reveal">
          <div className="eyebrow" style={{ marginBottom: 6 }}>сравнение с конкурентами</div>
          <div className="vs-table">
            {b.vs_competitors.map((v, i) => (
              <div key={i} className="vs-row">
                <b className="vs-name">{v.competitor}</b>
                <span className="vs-point"><Rich text={v.point} /></span>
                {src(v.source)}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {!!b.faq?.length && (
          <section className="card reveal">
            <div className="eyebrow" style={{ marginBottom: 6 }}>типовые вопросы</div>
            {b.faq.map((f, i) => (
              <details key={i} className="faq" open={i === 0}>
                <summary>{clip(clean(f.q), 140)}</summary>
                <p className="muted"><Rich text={clip(clean(f.a), 420)} /></p>
                {src(f.source)}
              </details>
            ))}
          </section>
        )}
        <section className="card reveal">
          <div className="eyebrow" style={{ marginBottom: 6 }}>возражения</div>
          {b.objections?.length ? b.objections.map((o, i) => (
            <div key={i} className="objection">
              <div className="obj-q">«{o.objection}»</div>
              <div className="muted"><Rich text={o.answer} /></div>
              {src(o.source)}
            </div>
          )) : <div className="nodata"><div className="nodata-title">Нет данных</div>Возражений в источниках не нашлось.</div>}
        </section>
      </div>

      {card && (
        <section className="card reveal">
          <div className="eyebrow" style={{ marginBottom: 10 }}>карточка товара</div>
          <StoreCard card={card} />
        </section>
      )}

      <section className="card reveal">
        <div className="eyebrow" style={{ marginBottom: 8 }}>сценарий видеообзора карточки</div>
        {b.video_script?.length ? (
          <div className="script">
            <div className="script-row script-head"><span>время</span><span>что на экране</span><span>текст</span></div>
            {b.video_script.map((v, i) => (
              <div key={i} className="script-row"><span className="mono">{v.sec}</span><span>{v.screen}</span><span className="muted">{v.voice}</span></div>
            ))}
          </div>
        ) : <div className="nodata"><div className="nodata-title">Нет данных</div>Сценарий собирается только с LLM — на этом стенде модель не подключена.</div>}
      </section>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {b.message && (
          <section className="dion reveal">
            <div className="dion-bar"><span className="dion-logo">D</span><b># продажи</b><span className="faint">Dion · мок мессенджера</span></div>
            <div className="dion-msg">
              <div className="mail-avatar sm">ПМ</div>
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <div className="row"><b>мини ПМ</b><span className="badge badge-ai" style={{ height: 18 }}>бот</span></div>
                <div className="dion-bubble"><Rich text={b.message} /></div>
              </div>
            </div>
          </section>
        )}
        {b.internal_note && (
          <section className="card internal reveal">
            <div className="eyebrow">только для ПМа</div>
            <p className="muted" style={{ marginTop: 6, whiteSpace: 'pre-line' }}><Rich text={b.internal_note} /></p>
          </section>
        )}
      </div>
    </>
  )
}

function SendBlock({ id, initial }: { id: string; initial?: MailSent }) {
  const [res, setRes] = useState<MailSent | null>(initial ?? null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try { setRes(await api.sendSalesBrief(id)) } catch (e) { setRes({ ok: false, error: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }
  return (
    <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
      <button className="btn" onClick={send} disabled={busy}>{busy ? <><span className="spinner" /> Отправляю…</> : 'Отправить продавцам на почту'}</button>
      {res && <MailStatus r={res} />}
    </div>
  )
}

/* ---------- ссылка на источник ---------- */
function SourceRef({ s, quotes }: { s?: string; quotes: Record<string, CuratedQuote> }) {
  if (!s) return null
  const parts = s.split(/\s*[|;,]\s*/).filter(Boolean)
  return (
    <span className="src-refs">
      {parts.map((p) => {
        const q = quotes[p]
        if (/^E-\d+/.test(p)) return <span key={p} className="src-ref" title={q ? `«${q.text}»\n${q.file}${q.sheet ? ' · ' + q.sheet : ''}${q.row ? ' · строка ' + q.row : ''}` : 'цитата аналитика'}>{p} · аналитик</span>
        if (/^https?:\/\//.test(p)) { let h = p; try { h = new URL(p).host } catch { /* как есть */ } return <a key={p} className="src-ref" href={p} target="_blank" rel="noreferrer">{h}</a> }
        if (/store_card/i.test(p)) return <span key={p} className="src-ref">карточка товара</span>
        return <span key={p} className="src-ref" title={`фрагмент базы знаний ${p}`}>база · {p.slice(0, 6)}</span>
      })}
    </span>
  )
}

const clean = (t: string) => t.replace(/^\[[^\]]+\]\s*/, '')
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
