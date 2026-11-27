import type { StorefrontCard } from '../api/types'

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
const host = (u?: string) => { try { return u ? new URL(u).host : '' } catch { return u ?? '' } }

/** Живая карточка товара store.softline.ru: название, цена, ссылка и найденные агентом проблемы витрины. */
export default function StoreCard({ card, compact = false }: { card: StorefrontCard; compact?: boolean }) {
  if (!card.ok) {
    return (
      <div className="nodata">
        <div className="nodata-title">Карточка недоступна</div>
        <div className="muted">{card.error ?? 'Не удалось получить страницу магазина.'}</div>
      </div>
    )
  }
  const issues = card.issues ?? []
  return (
    <div className="store-card">
      <div className="store-head">
        <span className="store-favicon" aria-hidden>S</span>
        <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
          <b className="store-title">{card.title}</b>
          <a className="faint mono store-url" href={card.url} target="_blank" rel="noreferrer">{host(card.url)}{card.live === false ? ' · снимок' : ''}</a>
        </div>
        {card.prices_rub?.length ? <span className="store-price">{rub(card.prices_rub[0])}</span> : null}
      </div>
      {issues.length > 0 && (
        <div className="store-issues">
          <div className="store-issues-title">Агент нашёл проблему на витрине</div>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}
      {!compact && issues.length === 0 && <div className="faint">Проблем на карточке не найдено.</div>}
      {card.fetched_at && <div className="faint">проверено {new Date(card.fetched_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{card.source ? ` · ${card.source}` : ''}</div>}
    </div>
  )
}
