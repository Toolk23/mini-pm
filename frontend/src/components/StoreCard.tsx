import type { StorefrontCard } from '../api/types'

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
const host = (u?: string) => { try { return u ? new URL(u).host : '' } catch { return u ?? '' } }
const time = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Живая карточка товара store.softline.ru в виде «экрана-терминала» (приём HackFirst «They said you were secure»):
 * тёмно-синее окно с помехами, находка агента — синим моноширинным капсом.
 */
export default function StoreCard({ card }: { card: StorefrontCard; compact?: boolean }) {
  if (!card.ok) {
    return (
      <div className="nodata">
        <div className="nodata-title">Карточка недоступна</div>
        <div className="muted">{card.error ?? 'Не удалось получить страницу магазина.'}</div>
      </div>
    )
  }
  const issues = card.issues ?? []
  const alert = issues.length > 0
  return (
    <div className={`term${alert ? ' alert' : ''}`}>
      <span className="term-glitch g1" aria-hidden /><span className="term-glitch g2" aria-hidden /><span className="term-glitch g3" aria-hidden />
      <div className="term-top">
        <span><i className="term-dot" aria-hidden />{alert ? 'агент нашёл проблему' : 'витрина проверена'}</span>
        <a href={card.url} target="_blank" rel="noreferrer">{host(card.url)}{card.live === false ? ' · снимок' : ''} ↗</a>
      </div>
      {alert
        ? issues.map((i) => <p key={i} className="term-alert">{i}</p>)
        : <p className="term-alert calm">проблем на карточке не найдено</p>}
      <div className="term-bottom">
        <span className="term-title">{card.title}</span>
        {card.prices_rub?.length ? <span className="term-price">{rub(card.prices_rub[0])}</span> : null}
      </div>
      {card.fetched_at && <div className="term-foot">проверено {time(card.fetched_at)}{card.source ? ` · ${card.source}` : ''}</div>}
    </div>
  )
}
