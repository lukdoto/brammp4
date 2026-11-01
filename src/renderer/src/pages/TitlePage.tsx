import { useEffect, useState } from 'react'
import type { FileView, TitleDetail } from '../../../shared/types'
import { resumeStart } from '../../../shared/rules'
import { MatchDialog } from '../components/MatchDialog'
import { ProgressBar } from '../components/ProgressBar'
import { codecLabel, imageUrl, itemLabel, minutesLabel, progressRatio, resolutionLabel, seasonsOf } from '../format'

function FileBadges({ f }: { f: FileView }) {
  return (
    <>
      {resolutionLabel(f.height) && <span className="badge">{resolutionLabel(f.height)}</span>}
      {codecLabel(f.videoCodec) && <span className="badge">{codecLabel(f.videoCodec)}</span>}
      <span className="badge">{f.audioCount} áudio{f.audioCount === 1 ? '' : 's'}</span>
      <span className="badge">{f.subCount} legenda{f.subCount === 1 ? '' : 's'}</span>
      <span className="badge">{f.libraryLabel}</span>
    </>
  )
}

function Backdrop({ file }: { file?: string }) {
  const url = imageUrl(file)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (!url || failed) return null
  return <img className="backdrop" src={url} alt="" onError={() => setFailed(true)} />
}

export function TitlePage({ id, refresh, onBack, onPlay, onChanged }: { id: number; refresh: number; onBack: () => void; onPlay: (itemKey: string) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [matching, setMatching] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [season, setSeason] = useState<number | null>(null)
  useEffect(() => {
    setDetail(null)
    setLoaded(false)
    setSeason(null)
  }, [id])
  useEffect(() => {
    let cancelled = false
    const apply = (d: TitleDetail | null) => {
      if (cancelled) return
      setDetail(d)
      setLoaded(true)
      const seasons = d ? seasonsOf(d.items) : []
      setSeason((cur) => (cur !== null && seasons.includes(cur) ? cur : (seasons[0] ?? null)))
    }
    window.api.getTitle(id).then(apply, () => apply(null))
    return () => {
      cancelled = true
    }
  }, [id, refresh])
  if (!detail) {
    return (
      <main>
        <button onClick={onBack}>← Voltar</button>
        <p>{loaded ? 'Título não encontrado. Ele pode ter sido removido do disco.' : 'Carregando…'}</p>
      </main>
    )
  }
  const items = detail.kind === 'series' ? detail.items.filter((i) => i.season === season) : detail.items
  return (
    <main>
      <button onClick={onBack}>← Voltar</button>
      <div className="title-head">
        <Backdrop file={detail.backdropFile} />
        <div className="title-head-body">
          <h1>{detail.name}</h1>
          <div className="meta">
            {detail.year ?? ''}
            {detail.matchSource === 'manual' && <span className="badge manual">Identificado manualmente</span>}
          </div>
          {detail.overview && <p className="overview">{detail.overview}</p>}
          <button onClick={() => setMatching(true)}>Corrigir identificação</button>
        </div>
      </div>
      {detail.kind === 'series' && (
        <div className="seasons">
          {seasonsOf(detail.items).map((s) => (
            <button key={s} className={s === season ? 'active' : ''} onClick={() => setSeason(s)}>Temporada {s}</button>
          ))}
        </div>
      )}
      {items.map((item) => {
        const best = item.files.find((f) => f.available) ?? item.files[0]
        if (!best) return null
        const offline = !item.files.some((f) => f.available)
        const watched = item.progress?.watched ?? false
        const ratio = progressRatio(item.progress, best.durationS)
        const canResume = resumeStart(item.progress?.positionS, watched) > 0
        return (
          <div key={item.key} className={`episode${offline ? ' unavailable' : ''}`}>
            <div className="code">{itemLabel(item.season, item.episode)}</div>
            <div className="info">
              <div>{item.episode !== null ? `Episódio ${item.episode}${item.name ? ` · ${item.name}` : ''}` : detail.name}</div>
              <div>
                <FileBadges f={best} />
                {best.durationS ? <span className="badge">{minutesLabel(best.durationS)}</span> : null}
                {item.files.length > 1 && <span className="badge">{item.files.length} versões</span>}
                {watched && <span className="badge done">Assistido</span>}
                {offline && <span className="badge">conecte {best.libraryLabel}</span>}
              </div>
              {item.overview && <div className="ep-overview">{item.overview}</div>}
              {ratio !== undefined && <ProgressBar ratio={ratio} watched={watched} />}
            </div>
            <button className="primary" disabled={offline} onClick={() => onPlay(item.key)}>
              {canResume ? 'Continuar' : watched ? 'Assistir de novo' : 'Assistir'}
            </button>
          </div>
        )
      })}
      {matching && (
        <MatchDialog
          titleId={detail.id}
          kind={detail.kind}
          initialQuery={detail.name}
          onClose={() => setMatching(false)}
          onAssigned={onChanged}
        />
      )}
    </main>
  )
}
