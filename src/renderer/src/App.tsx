import { useCallback, useEffect, useState } from 'react'
import type { LibraryView, PlayerState, ScanProgress, ScanSummary } from '../../shared/types'
import { PlayPanel } from './components/PlayPanel'
import { Home } from './pages/Home'
import { Libraries } from './pages/Libraries'
import { TitlePage } from './pages/TitlePage'

type View = { name: 'home' } | { name: 'title'; id: number } | { name: 'libraries' }

const CLOSED_NOTICES: Partial<Record<NonNullable<PlayerState['closedReason']>, string>> = {
  disconnected: 'O disco foi desconectado durante a reprodução. Seu ponto foi salvo.',
  error: 'Não foi possível reproduzir este vídeo.'
}

export function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [libraries, setLibraries] = useState<LibraryView[]>([])
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({})
  const [summaries, setSummaries] = useState<Record<string, ScanSummary>>({})
  const [refresh, setRefresh] = useState(0)
  const [playItem, setPlayItem] = useState<string | null>(null)
  const [player, setPlayer] = useState<PlayerState>({ playing: false })
  const [notice, setNotice] = useState<string | null>(null)

  const reloadLibraries = () => void window.api.listLibraries().then(setLibraries)
  const closePanel = useCallback(() => setPlayItem(null), [])

  useEffect(() => {
    void window.api.listLibraries().then((libs) => {
      setLibraries(libs)
      if (libs.length === 0) setView({ name: 'libraries' })
    })
    void window.api.getPlayerState().then(setPlayer, () => {})
    const offs = [
      window.api.onLibraryStatus(() => {
        reloadLibraries()
        setRefresh((r) => r + 1)
      }),
      window.api.onScanProgress((p) => setProgress((cur) => ({ ...cur, [p.libraryId]: p }))),
      window.api.onScanDone((s) => {
        setSummaries((cur) => ({ ...cur, [s.libraryId]: s }))
        setProgress((cur) => {
          const { [s.libraryId]: _done, ...rest } = cur
          return rest
        })
        reloadLibraries()
        setRefresh((r) => r + 1)
      }),
      window.api.onPlayerState((s) => {
        setPlayer(s)
        if (!s.playing) {
          setRefresh((r) => r + 1) // barras e "Continuar assistindo" mudaram
          setNotice((s.closedReason && CLOSED_NOTICES[s.closedReason]) || null)
        } else setNotice(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 10000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <>
      <header className="top">
        <span className="logo" onClick={() => setView({ name: 'home' })}>brammp4</span>
        <span className="spacer" />
        <button onClick={() => setView({ name: 'libraries' })}>Bibliotecas</button>
      </header>
      {player.playing && (
        <div className="banner now-playing">Reproduzindo: {player.label}. Feche o player (tecla Q ou o X da janela) para voltar ao catálogo.</div>
      )}
      {notice && <div className="banner warn" onClick={() => setNotice(null)}>{notice}</div>}
      {view.name === 'home' && (
        <Home refresh={refresh} libraries={libraries} onOpen={(id) => setView({ name: 'title', id })} onPlay={setPlayItem} />
      )}
      {view.name === 'title' && (
        <TitlePage id={view.id} refresh={refresh} onBack={() => setView({ name: 'home' })} onPlay={setPlayItem} />
      )}
      {view.name === 'libraries' && (
        <Libraries libraries={libraries} progress={progress} summaries={summaries} onChanged={reloadLibraries} />
      )}
      {playItem && <PlayPanel key={playItem} itemKey={playItem} onClose={closePanel} />}
    </>
  )
}
