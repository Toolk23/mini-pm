import Placeholder from '../components/Placeholder'

export default function Story() {
  return <Placeholder title="Сквозная история" when="27.11, до 14:00"
    subtitle="Главный демо-флоу на одном экране"
    todo={['Сигнал → расследование → письмо → задача в борде → гипотеза → замер эффекта с вердиктом',
      'Два сценария «после хотфикса»: индекс вернулся / не вернулся']} />
}
