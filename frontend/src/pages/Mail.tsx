import Placeholder from '../components/Placeholder'

export default function Mail() {
  return <Placeholder title="Письма ПМу" when="сегодня, блок 4"
    subtitle="Что «мини ПМ» отправил продакт-менеджеру"
    todo={['Превью письма (тема, тело, ссылка на .eml)', 'Сообщение в стиле Dion']} />
}
