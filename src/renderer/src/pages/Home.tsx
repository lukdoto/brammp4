import { useEffect, useState } from 'react'
import type { Catalog, LibraryView, TitleCard } from '../../../shared/types'
import { TitleCardView } from '../components/TitleCardView'

function Row({ title, cards, onOpen }: { title: string; cards: TitleCard[]; onOpen: (id: number) => void }) {
  if (cards.length === 0) return null
  return (
    <section className="row">
      <h2>{title}</h2>
      <div className="cards">{cards.map((c) => <TitleCardView key={c.id} card={c} onOpen={onOpen} />)}</div>
    </section>
  )
}

export function Home({ refresh, libraries, onOpen }: { refresh: number; libraries: LibraryView[]; onOpen: (id: number) => void }) {
  const [catalog, setCatalog] = useState<Catalog>({ series: [], movies: [] })
  useEffect(() => {
    void window.api.getCatalog().then(setCatalog)
  }, [refresh])
  const offline = libraries.filter((l) => l.status === 'offline')
  const empty = catalog.series.length === 0 && catalog.movies.length === 0
  return (
    <main>
      {offline.length > 0 && <div className="banner">Desconectado: {offline.map((l) => l.label).join(', ')}. Os títulos continuam aqui, acinzentados.</div>}
      {empty && <p>Nenhum título ainda. Se a varredura estiver em andamento, aguarde; senão, confira a pasta em Bibliotecas.</p>}
      <Row title="Séries" cards={catalog.series} onOpen={onOpen} />
      <Row title="Filmes" cards={catalog.movies} onOpen={onOpen} />
    </main>
  )
}
