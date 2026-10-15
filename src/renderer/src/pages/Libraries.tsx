import { useState } from 'react'
import type { LibraryView, ScanProgress, ScanSummary } from '../../../shared/types'

interface Props {
  libraries: LibraryView[]
  progress: Record<string, ScanProgress>
  summaries: Record<string, ScanSummary>
  onChanged: () => void
}

function SummaryLine({ s }: { s: ScanSummary }) {
  if (s.aborted) return <div className="summary error">Varredura interrompida: o disco foi desconectado.</div>
  return (
    <div className="summary">
      {s.series} séries · {s.episodes} episódios · {s.movies} filmes · {s.subtitles} legendas
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
            <button disabled={l.status === 'offline'} onClick={() => void window.api.rescanLibrary(l.id)}>Revarrer</button>
          </div>
        )
      })}
    </main>
  )
}
