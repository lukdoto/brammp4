import { useEffect, useState } from 'react'
import type { LibraryView, ScanProgress, ScanSummary } from '../../shared/types'
import { Home } from './pages/Home'
import { Libraries } from './pages/Libraries'
import { TitlePage } from './pages/TitlePage'

type View = { name: 'home' } | { name: 'title'; id: number } | { name: 'libraries' }

export function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [libraries, setLibraries] = useState<LibraryView[]>([])
  const [progress, setProgress] = useState<Record<string, ScanProgress>>({})
  const [summaries, setSummaries] = useState<Record<string, ScanSummary>>({})
  const [refresh, setRefresh] = useState(0)

  const reloadLibraries = () => void window.api.listLibraries().then(setLibraries)

  useEffect(() => {
    void window.api.listLibraries().then((libs) => {
      setLibraries(libs)
      if (libs.length === 0) setView({ name: 'libraries' })
    })
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
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <>
      <header className="top">
        <span className="logo" onClick={() => setView({ name: 'home' })}>brammp4</span>
        <span className="spacer" />
        <button onClick={() => setView({ name: 'libraries' })}>Bibliotecas</button>
      </header>
      {view.name === 'home' && <Home refresh={refresh} libraries={libraries} onOpen={(id) => setView({ name: 'title', id })} />}
      {view.name === 'title' && <TitlePage id={view.id} refresh={refresh} onBack={() => setView({ name: 'home' })} />}
      {view.name === 'libraries' && (
        <Libraries libraries={libraries} progress={progress} summaries={summaries} onChanged={reloadLibraries} />
      )}
    </>
  )
}
