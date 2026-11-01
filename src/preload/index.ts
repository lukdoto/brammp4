import { contextBridge, ipcRenderer } from 'electron'
import type { BrammApi } from '../shared/types'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: BrammApi = {
  listLibraries: () => ipcRenderer.invoke('libraries:list'),
  addLibrary: (label) => ipcRenderer.invoke('libraries:add', label),
  rescanLibrary: (id) => ipcRenderer.invoke('libraries:rescan', id),
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  getTitle: (id) => ipcRenderer.invoke('title:get', id),
  getContinueWatching: () => ipcRenderer.invoke('continue:list'),
  getPlayOptions: (itemKey) => ipcRenderer.invoke('play:options', itemKey),
  play: (req) => ipcRenderer.invoke('play:start', req),
  getPlayerState: () => ipcRenderer.invoke('play:state'),
  onPlayerState: (cb) => on('player:state', cb),
  onLibraryStatus: (cb) => on('libraries:status', cb),
  onScanProgress: (cb) => on('scan:progress', cb),
  onScanDone: (cb) => on('scan:done', cb),
  getTmdbStatus: () => ipcRenderer.invoke('tmdb:status'),
  setTmdbKey: (key) => ipcRenderer.invoke('tmdb:set-key', key),
  clearTmdbKey: () => ipcRenderer.invoke('tmdb:clear-key'),
  searchTmdb: (req) => ipcRenderer.invoke('tmdb:search', req),
  assignTmdb: (req) => ipcRenderer.invoke('tmdb:assign', req),
  listUnmatched: () => ipcRenderer.invoke('unmatched:list'),
  reclassify: (req) => ipcRenderer.invoke('unmatched:reclassify', req),
  onMetadataChanged: (cb) => on('metadata:changed', cb)
}

contextBridge.exposeInMainWorld('api', api)
