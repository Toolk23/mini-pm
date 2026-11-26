import Placeholder from '../components/Placeholder'

export default function SettingsPage() {
  return <Placeholder title="Настройки" when="27.11, до 17:00"
    subtitle="Пороги детектора — меняются здесь, детектор сразу реагирует"
    todo={['Правила по метрикам: порог, вкл/выкл, приоритет', 'Параметры детектора', 'После сохранения — лента сигналов обновляется']} />
}
