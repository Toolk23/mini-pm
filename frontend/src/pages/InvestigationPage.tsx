import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { pollInvestigation } from '../api/client'
import type { Investigation } from '../api/types'
import { Card, ErrorBox, PageHead } from '../components/ui'

// Каркас: опрос статуса + краткий отчёт. Полная страница (шаги, цитаты, причины, «нет данных») — блок 3.
export default function InvestigationPage() {
  const { id = '' } = useParams()
  const [inv, setInv] = useState<Investigation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setInv(null)
    pollInvestigation(id, setInv, ctrl.signal).catch((e) => {
      if (e?.name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    })
    return () => ctrl.abort()
  }, [id])

  const rep = inv?.report
  return (
    <>
      <PageHead title={`Расследование ${id}`} subtitle={inv?.signal_id} />
      {error && <ErrorBox error={error} />}
      {inv?.status === 'running' && (
        <Card><div className="empty row" style={{ justifyContent: 'center' }}><span className="spinner" /> Следователь собирает доказательства по источникам…</div></Card>
      )}
      {inv?.status === 'error' && <ErrorBox error={inv.error ?? 'ошибка расследования'} />}
      {rep && (
        <>
          <Card title="Итог" extra={<span className="badge">{rep.mode}</span>}>
            <p>{rep.summary}</p>
          </Card>
          <Card title={`Шаги (${rep.steps.length})`}>
            <ol style={{ margin: 0, paddingLeft: 18 }} className="stack">
              {rep.steps.map((s) => <li key={s.n}><strong>{s.title}.</strong> <span className="muted">{s.finding}</span></li>)}
            </ol>
          </Card>
        </>
      )}
    </>
  )
}
