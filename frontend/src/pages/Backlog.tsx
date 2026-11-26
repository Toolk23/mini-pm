import { api } from '../api/client'
import { AI_TAG, AiBadge, Card, ErrorBox, Loading, PageHead, PriorityBadge, useApi } from '../components/ui'

// Каркас: список задач. Колонки-борд, карточка и экспорт в Redmine — блок 4.
export default function Backlog() {
  const tasks = useApi(() => api.tasks())
  return (
    <>
      <PageHead title="Бэклог" subtitle="Задачи продукта; созданные агентом помечены тегом" />
      {tasks.loading && <Loading />}
      {tasks.error && <ErrorBox error={tasks.error} onRetry={tasks.reload} />}
      {tasks.data && (
        <Card>
          <div className="stack">
            {tasks.data.map((t) => (
              <div key={t.task_id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="row">
                  <code>{t.task_id}</code> <strong>{t.title}</strong>
                  {t.tags?.includes(AI_TAG) && <AiBadge />}
                </div>
                <div className="row"><span className="badge">{t.status}</span><PriorityBadge p={t.priority} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
