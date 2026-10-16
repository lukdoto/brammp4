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
  seasons: number
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

export interface Catalog { series: TitleCard[]; movies: TitleCard[]; recent: TitleCard[] }

export interface FileView {
  id: number
  relPath: string
  libraryLabel: string
  available: boolean
  height?: number
  videoCodec?: string
  durationS?: number
  audioCount: number
  subCount: number
}

export interface ItemView { key: string; season: number | null; episode: number | null; name?: string; files: FileView[]; progress?: ProgressView }

export interface TitleDetail {
  id: number
  kind: 'series' | 'movie'
  name: string
  year?: number
  items: ItemView[]
}

export interface ProgressView {
  positionS: number
  durationS?: number
  watched: boolean
  updatedAt: string
}

export interface ContinueCard {
  titleId: number
  titleName: string
  kind: 'series' | 'movie'
  itemKey: string
  season: number | null
  episode: number | null
  episodeName?: string
  positionS: number
  durationS?: number
  available: boolean
}

export interface AudioOption {
  /** posição 1-based entre as faixas de áudio do arquivo; é o --aid do mpv */
  typeIndex: number
  lang?: string
  title?: string
  codec: string
  isDefault: boolean
}

export interface SubOption {
  source: 'embedded' | 'external'
  /** só embutidas: posição 1-based entre as legendas do arquivo; é o --sid do mpv */
  typeIndex?: number
  /** só externas: caminho relativo à pasta da biblioteca */
  externalPath?: string
  lang?: string
  title?: string
  codec: string
  isDefault: boolean
  isForced: boolean
  isSdh: boolean
}

export type SubChoice =
  | { kind: 'off' }
  | { kind: 'embedded'; typeIndex: number }
  | { kind: 'external'; relPath: string }

export interface TrackSelection {
  audioTypeIndex: number | null
  sub: SubChoice
}

export interface FileOption {
  fileId: number
  libraryLabel: string
  height?: number
  videoCodec?: string
  available: boolean
  audio: AudioOption[]
  subs: SubOption[]
  defaults: TrackSelection
}

export interface PlayOptions {
  itemKey: string
  titleId: number
  titleName: string
  kind: 'series' | 'movie'
  season: number | null
  episode: number | null
  episodeName?: string
  files: FileOption[]
  defaultFileId: number | null
  progress?: ProgressView
  /** de onde "Continuar" começa; 0 quando não há o que continuar */
  resumeFromS: number
}

export interface PlayRequest {
  itemKey: string
  fileId: number
  startS: number
  selection: TrackSelection
}

export type PlayError = 'invalid' | 'already-playing' | 'offline' | 'missing-file' | 'mpv-missing' | 'start-failed'
export type PlayResult = { ok: true } | { ok: false; error: PlayError }
export type PlayerClosedReason = 'ended' | 'closed' | 'disconnected' | 'error'

export interface PlayerState {
  playing: boolean
  itemKey?: string
  /** ex.: "Dark · S01E03" */
  label?: string
  closedReason?: PlayerClosedReason
}

export interface BrammApi {
  listLibraries(): Promise<LibraryView[]>
  addLibrary(label: string): Promise<LibraryView | null>
  rescanLibrary(id: string): Promise<ScanSummary>
  getCatalog(): Promise<Catalog>
  getTitle(id: number): Promise<TitleDetail | null>
  getContinueWatching(): Promise<ContinueCard[]>
  getPlayOptions(itemKey: string): Promise<PlayOptions | null>
  play(req: PlayRequest): Promise<PlayResult>
  getPlayerState(): Promise<PlayerState>
  onPlayerState(cb: (s: PlayerState) => void): () => void
  onLibraryStatus(cb: (lib: LibraryView) => void): () => void
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onScanDone(cb: (s: ScanSummary) => void): () => void
}
