export type ParsedVideo =
  | { kind: 'episode'; seriesName: string; year?: number; season: number; episodes: number[]; episodeTitle?: string }
  | { kind: 'movie'; title: string; year?: number }

export interface ProbeTrack {
  type: 'audio' | 'sub'
  streamIndex: number
  /** posição 1-based dentro do tipo; é o número que o mpv usa em --aid/--sid */
  typeIndex: number
  codec: string
  lang?: string
  title?: string
  isDefault: boolean
  isForced: boolean
}

export interface ProbeResult {
  durationS?: number
  width?: number
  height?: number
  videoCodec?: string
  tracks: ProbeTrack[]
}

export type LibraryStatus = 'online' | 'offline'

export interface LibraryView {
  id: string
  label: string
  rootPath: string
  status: LibraryStatus
  lastScanAt?: string
}

export interface ScanProgress { libraryId: string; done: number; total: number; current?: string }

export interface ScanSummary {
  libraryId: string
  aborted: boolean
  videos: number
  probed: number
  series: number
  movies: number
  episodes: number
  subtitles: number
  unmatched: number
}

export interface TitleCard {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
  available: boolean
  offlineLabels: string[]
}

export interface Catalog { series: TitleCard[]; movies: TitleCard[] }

export interface FileView {
  id: number
  relPath: string
  libraryLabel: string
  available: boolean
  height?: number
  videoCodec?: string
  audioCount: number
  subCount: number
}

export interface ItemView { key: string; season: number | null; episode: number | null; files: FileView[] }

export interface TitleDetail {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
  items: ItemView[]
}

export interface BrammApi {
  listLibraries(): Promise<LibraryView[]>
  addLibrary(label: string): Promise<LibraryView | null>
  rescanLibrary(id: string): Promise<ScanSummary>
  getCatalog(): Promise<Catalog>
  getTitle(id: number): Promise<TitleDetail | null>
  onLibraryStatus(cb: (lib: LibraryView) => void): () => void
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onScanDone(cb: (s: ScanSummary) => void): () => void
}
