import type { TitleCard } from '../../../shared/types'
import { Poster } from './Poster'

export { initials, posterStyle } from './Poster'

export function TitleCardView({ card, onOpen }: { card: TitleCard; onOpen: (id: number) => void }) {
  return (
    <div className={`card${card.available ? '' : ' unavailable'}`} onClick={() => onOpen(card.id)} title={card.name}>
      <Poster name={card.name} posterFile={card.posterFile} />
      <div className="name">{card.name}</div>
      <div className="meta">
        {card.year ?? ''}
        {!card.available && card.offlineLabels.length > 0 && ` · conecte ${card.offlineLabels.join(' ou ')}`}
      </div>
    </div>
  )
}
