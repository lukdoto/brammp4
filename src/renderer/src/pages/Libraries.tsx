import { useState } from 'react'
import { plural } from '../format'
import type { LibraryView, ScanProgress, ScanSummary } from '../../../shared/types'

interface Props {
  libraries: LibraryView[]
  progress: Record<string, ScanProgress>
  summaries: Record<string, ScanSummary>
  onChanged: () => void
}

function SummaryLine({ s }: { s: ScanSummary }) {
  if (s.aborted) return <div className="summary error">Varredura interrompida. Confira a conexão do disco e tente novamente.</div>
  return (
    <div className="summary">
      {plural(s.series, 'série', 'séries')} · {plural(s.episodes, 'episódio', 'episódios')} · {plural(s.movies, 'filme', 'filmes')} · {plural(s.subtitles, 'legenda', 'legendas')}
      {s.unmatched > 0 && ` · ${s.unmatched} não identificados`}
    </div>
  )
}

export function Libraries({ libraries, progress, summaries, onChanged }: Props) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const lib = await window.api.addLibrary(label)
      if (lib) setLabel('')
      onChanged()
    } catch (e) {
      setError(`Não foi possível usar essa pasta: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function rescan(id: string) {
    setError(null)
    window.api.rescanLibrary(id).catch((e: unknown) => setError(`Não foi possível revarrer: ${(e as Error).message}`))
  }

  return (
    <main>
      <h1>Bibliotecas</h1>
      <p>Escolha a pasta do catálogo dentro do disco removível. O app lembra o endereço e confere a conexão sozinho.</p>
      <div className="add">
        <input placeholder="Apelido (ex.: HD Séries)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="primary" disabled={busy} onClick={add}>Escolher pasta…</button>
      </div>
      {error && <p className="error">{error}</p>}
      {libraries.map((l) => {
        const p = progress[l.id]
        const s = summaries[l.id]
        const scanning = p && p.done < p.total
        return (
          <div key={l.id} className="lib">
            <div className={`dot ${l.status}`} title={l.status === 'online' ? 'conectado' : 'desconectado'} />
            <div className="body">
              <div>{l.label} {l.status === 'offline' && <span className="badge">desconectado</span>}</div>
              <div className="path">{l.rootPath}</div>
              {scanning && (
                <>
                  <div className="summary">Lendo {p.done} de {p.total} arquivos…</div>
                  <div className="bar"><div style={{ width: `${Math.round((p.done / Math.max(p.total, 1)) * 100)}%` }} /></div>
                </>
              )}
              {!scanning && s && <SummaryLine s={s} />}
            </div>
            <button disabled={l.status === 'offline'} onClick={() => rescan(l.id)}>Revarrer</button>
          </div>
        )
      })}
    </main>
  )
}
