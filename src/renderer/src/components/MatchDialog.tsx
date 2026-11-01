import { useState } from 'react'
import type { TmdbCandidate } from '../../../shared/types'
import { assignError } from '../format'

interface Props {
  titleId: number
  kind: 'series' | 'movie'
  initialQuery: string
  onClose: () => void
  onAssigned: () => void
}

export function MatchDialog({ titleId, kind, initialQuery, onClose, onAssigned }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<TmdbCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      setResults(await window.api.searchTmdb({ kind, query: q }))
    } catch {
      setResults(null)
      setError('Não foi possível buscar no TMDB. Verifique a chave em Configurações e a conexão.')
    } finally {
      setBusy(false)
    }
  }

  async function choose(tmdbId: number) {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.assignTmdb({ titleId, tmdbId })
      if (r.ok) {
        onAssigned()
        onClose()
        return
      }
      setError(assignError(r.error))
    } catch {
      setError('Não foi possível aplicar a identificação.')
    }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Corrigir identificação" onClick={(e) => e.stopPropagation()}>
        <h2>Corrigir identificação</h2>
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome no TMDB" />
          <button className="primary" type="submit" disabled={busy || !query.trim()}>Buscar</button>
        </form>
        {error && <p className="error">{error}</p>}
        {results && results.length === 0 && <p>Nenhum resultado. Tente outro nome.</p>}
        {results?.map((c) => (
          <div key={c.tmdbId} className="candidate">
            <div className="info">
              <div>{c.name}{c.year ? ` (${c.year})` : ''}</div>
              {c.overview && <div className="ep-overview">{c.overview.length > 160 ? `${c.overview.slice(0, 160)}…` : c.overview}</div>}
            </div>
            <button disabled={busy} onClick={() => void choose(c.tmdbId)}>Escolher</button>
          </div>
        ))}
        <div className="actions">
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
