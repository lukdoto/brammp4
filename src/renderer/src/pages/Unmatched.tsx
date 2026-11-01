import { useEffect, useState } from 'react'
import type { ReclassifyTarget, UnmatchedFile } from '../../../shared/types'
import { parseEpisodeInput, parseYearInput, reclassifyError } from '../format'

const SERIES_LIST_ID = 'unmatched-series'

/** Nome mostrado (minúsculo, aparado) -> id da série; null quando o nome se repete (ambíguo). */
type SeriesIndex = Map<string, number | null>

const nameKey = (s: string) => s.trim().toLocaleLowerCase()

function Row({ file, series: seriesIndex, onDone }: { file: UnmatchedFile; series: SeriesIndex; onDone: () => void }) {
  const [kind, setKind] = useState<'movie' | 'episode'>('movie')
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [series, setSeries] = useState('')
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    let target: ReclassifyTarget
    let titleId: number | undefined
    if (kind === 'movie') {
      const y = parseYearInput(year)
      if (!title.trim() || !y.ok) return setError('Informe o título e, se quiser, um ano entre 1870 e 2200.')
      target = { kind: 'movie', title: title.trim(), ...(y.year !== undefined ? { year: y.year } : {}) }
    } else {
      const se = parseEpisodeInput(season, episode)
      if (!series.trim() || !se) return setError('Informe a série, a temporada (0 a 200) e o episódio (1 a 9999).')
      target = { kind: 'episode', series: series.trim(), ...se }
      // série da lista: o main reaproveita o título mesmo que o nome mostrado seja o do TMDB
      titleId = seriesIndex.get(nameKey(series)) ?? undefined
    }
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.reclassify({
        libraryId: file.libraryId,
        relPath: file.relPath,
        target,
        ...(titleId !== undefined ? { titleId } : {})
      })
      if (r.ok) onDone() // a página recarrega a lista; se o arquivo continuar aqui, a linha fica livre
      else setError(r.error === 'offline' ? `${reclassifyError(r.error)} (${file.libraryLabel})` : reclassifyError(r.error))
    } catch {
      setError('Não foi possível reclassificar este arquivo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lib unmatched-row">
      <div className="body">
        <div>{file.relPath}</div>
        <div className="path">{file.libraryLabel}</div>
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void submit()
          }}
        >
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as 'movie' | 'episode')}>
            <option value="movie">Filme</option>
            <option value="episode">Episódio</option>
          </select>
          {kind === 'movie' ? (
            <>
              <input placeholder="Título" maxLength={200} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
              <input className="narrow" placeholder="Ano (opcional)" inputMode="numeric" value={year} disabled={busy} onChange={(e) => setYear(e.target.value)} />
            </>
          ) : (
            <>
              <input placeholder="Série" maxLength={200} list={SERIES_LIST_ID} value={series} disabled={busy} onChange={(e) => setSeries(e.target.value)} />
              <input className="narrow" placeholder="Temporada" inputMode="numeric" value={season} disabled={busy} onChange={(e) => setSeason(e.target.value)} />
              <input className="narrow" placeholder="Episódio" inputMode="numeric" value={episode} disabled={busy} onChange={(e) => setEpisode(e.target.value)} />
            </>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Aguarde…' : 'Reclassificar'}
          </button>
        </form>
        {busy && <p className="summary">Reclassificando e reescaneando a biblioteca. Isso pode demorar em discos grandes.</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

export function Unmatched({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const [files, setFiles] = useState<UnmatchedFile[] | null>(null)
  const [seriesNames, setSeriesNames] = useState<string[]>([])
  const [seriesIndex, setSeriesIndex] = useState<SeriesIndex>(new Map())
  const [failed, setFailed] = useState(false)

  const reload = () =>
    window.api.listUnmatched().then(
      (f) => {
        setFiles(f)
        setFailed(false)
      },
      () => setFailed(true)
    )

  useEffect(() => {
    void reload()
    void window.api.getCatalog().then(
      (c) => {
        const index: SeriesIndex = new Map()
        for (const s of c.series) {
          const k = nameKey(s.name)
          index.set(k, index.has(k) ? null : s.id)
        }
        setSeriesIndex(index)
        setSeriesNames([...new Set(c.series.map((s) => s.name))].sort((a, b) => a.localeCompare(b)))
      },
      () => {}
    )
  }, [refresh])

  return (
    <main>
      <h1>Não identificados</h1>
      <p>Arquivos que o app não conseguiu classificar pelo nome. Diga o que cada um é para que entrem no catálogo.</p>
      <datalist id={SERIES_LIST_ID}>
        {seriesNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {failed && <p className="error">Não foi possível carregar a lista.</p>}
      {files && files.length === 0 && <p>Nenhum arquivo para identificar.</p>}
      {files?.map((f) => (
        <Row key={`${f.libraryId}\u0000${f.relPath}`} file={f} series={seriesIndex} onDone={onChanged} />
      ))}
    </main>
  )
}
