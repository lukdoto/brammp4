import { useEffect, useState } from 'react'
import type { Catalog, ContinueCard, LibraryView, TitleCard } from '../../../shared/types'
import { ProgressBar } from '../components/ProgressBar'
import { initials, posterStyle, TitleCardView } from '../components/TitleCardView'
import { formatClock, itemLabel, progressRatio } from '../format'

function Row({ title, cards, onOpen }: { title: string; cards: TitleCard[]; onOpen: (id: number) => void }) {
  if (cards.length === 0) return null
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="cards">{cards.map((c) => <TitleCardView key={c.id} card={c} onOpen={onOpen} />)}</div>
    </section>
  )
}

function ContinueCardView({ card, onPlay }: { card: ContinueCard; onPlay: (itemKey: string) => void }) {
  const ratio = progressRatio({ positionS: card.positionS, durationS: card.durationS, watched: false })
  const remaining = card.durationS ? Math.max(0, card.durationS - card.positionS) : undefined
  return (
    <div className={`card wide${card.available ? '' : ' unavailable'}`} onClick={() => onPlay(card.itemKey)} title={card.titleName}>
      <div className="poster" style={posterStyle(card.titleName)}>{initials(card.titleName)}</div>
      <div className="name">{card.titleName}</div>
      <div className="meta">
        {card.kind === 'series' ? `${itemLabel(card.season, card.episode)}${card.episodeName ? ` · ${card.episodeName}` : ''}` : 'Filme'}
        {card.positionS > 0 && remaining !== undefined ? ` · faltam ${formatClock(remaining)}` : ''}
        {!card.available && ' · disco desconectado'}
      </div>
      {ratio !== undefined && ratio > 0 && <ProgressBar ratio={ratio} />}
    </div>
  )
}

export function Home({
  refresh,
  libraries,
  onOpen,
  onPlay
}: {
  refresh: number
  libraries: LibraryView[]
  onOpen: (id: number) => void
  onPlay: (itemKey: string) => void
}) {
  const [catalog, setCatalog] = useState<Catalog>({ series: [], movies: [], recent: [] })
  const [continueCards, setContinueCards] = useState<ContinueCard[]>([])
  useEffect(() => {
    let cancelled = false
    void window.api.getCatalog().then((c) => !cancelled && setCatalog(c))
    void window.api.getContinueWatching().then((c) => !cancelled && setContinueCards(c), () => {})
    return () => {
      cancelled = true
    }
  }, [refresh])
  const offline = libraries.filter((l) => l.status === 'offline')
  const empty = catalog.series.length === 0 && catalog.movies.length === 0
  return (
    <main>
      {offline.length > 0 && <div className="banner">Desconectado: {offline.map((l) => l.label).join(', ')}. Os títulos continuam aqui, acinzentados.</div>}
      {empty && <p>Nenhum título ainda. Se a varredura estiver em andamento, aguarde; senão, confira a pasta em Bibliotecas.</p>}
      {continueCards.length > 0 && (
        <section className="row">
          <h2>Continuar assistindo</h2>
          <div className="cards">{continueCards.map((c) => <ContinueCardView key={c.titleId} card={c} onPlay={onPlay} />)}</div>
        </section>
      )}
      <Row title="Adicionados recentemente" cards={catalog.recent} onOpen={onOpen} />
      <Row title="Séries" cards={catalog.series} onOpen={onOpen} />
      <Row title="Filmes" cards={catalog.movies} onOpen={onOpen} />
    </main>
  )
}
