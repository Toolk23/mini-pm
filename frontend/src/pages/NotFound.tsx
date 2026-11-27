import { Link } from 'react-router-dom'
import { Card } from '../components/ui'

export default function NotFound() {
  return <Card><div className="empty">Такой страницы нет. <Link to="/">На дашборд</Link></div></Card>
}
