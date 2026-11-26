import { Card, PageHead } from './ui'

/** Заглушка раздела: что здесь будет и когда. Убирается, когда раздел готов. */
export default function Placeholder({ title, subtitle, todo, when }: { title: string; subtitle: string; todo: string[]; when: string }) {
  return (
    <>
      <PageHead title={title} subtitle={subtitle} />
      <Card title="Раздел в работе" extra={<span className="badge">{when}</span>}>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          {todo.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </Card>
    </>
  )
}
