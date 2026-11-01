import { useEffect, useRef, useState } from 'react'
import type { TmdbCandidate } from '../../../shared/types'
import { assignError, searchError } from '../format'

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
  // o listener de Escape precisa do valor atual sem se registrar de novo a cada mudança
  const busyRef = useRef(false)
  busyRef.current = busy

  const close = () => {
    if (!busyRef.current) onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function search() {
    if (busy) return
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.searchTmdb({ kind, query: q })
      if (r.ok) setResults(r.results)
      else {
        setResults(null)
        setError(searchError(r.error))
      }
    } catch {
      setResults(null)
      setError('Não foi possível buscar no TMDB. Verifique a chave em Configurações e a conexão.')
    } finally {
      setBusy(false)
    }
  }

  async function choose(tmdbId: number) {
    if (busy) return
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
    <div className="modal-bg" onClick={close}>
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
          <button onClick={close} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
