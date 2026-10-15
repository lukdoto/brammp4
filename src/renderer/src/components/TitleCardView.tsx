import type { TitleCard } from '../../../shared/types'

function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join('')
}

export function TitleCardView({ card, onOpen }: { card: TitleCard; onOpen: (id: number) => void }) {
  const h = hue(card.name)
  return (
    <div className={`card${card.available ? '' : ' unavailable'}`} onClick={() => onOpen(card.id)} title={card.name}>
      <div className="poster" style={{ background: `linear-gradient(160deg, hsl(${h} 45% 35%), hsl(${(h + 40) % 360} 50% 15%))` }}>
        {initials(card.name)}
      </div>
      <div className="name">{card.name}</div>
      <div className="meta">
        {card.year ?? ''}
        {!card.available && card.offlineLabels.length > 0 && ` · conecte ${card.offlineLabels.join(' ou ')}`}
      </div>
    </div>
  )
}
