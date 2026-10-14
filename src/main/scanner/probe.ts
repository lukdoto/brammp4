import { execFile } from 'node:child_process'
import type { ProbeResult, ProbeTrack } from '../../shared/types'
import { normalizeLang } from '../parser/subtitle'

interface FfStream {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  tags?: { language?: string; title?: string }
  disposition?: { default?: number; forced?: number; attached_pic?: number }
}

export function parseFfprobe(json: unknown): ProbeResult {
  const j = (json ?? {}) as { streams?: FfStream[]; format?: { duration?: string } }
  const streams = j.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const tracks: ProbeTrack[] = []
  let audio = 0
  let sub = 0
  for (const s of streams) {
    if (s.codec_type !== 'audio' && s.codec_type !== 'subtitle') continue
    const type = s.codec_type === 'audio' ? 'audio' : 'sub'
    tracks.push({
      type,
      streamIndex: s.index,
      typeIndex: type === 'audio' ? ++audio : ++sub,
      codec: s.codec_name ?? 'desconhecido',
      lang: normalizeLang(s.tags?.language),
      title: s.tags?.title,
      isDefault: s.disposition?.default === 1,
      isForced: s.disposition?.forced === 1
    })
  }
  const d = Number(j.format?.duration)
  return {
    durationS: Number.isFinite(d) ? d : undefined,
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    tracks
  }
}

export function probeFile(ffprobePath: string, absPath: string, timeoutMs = 30000): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absPath]
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(parseFfprobe(JSON.parse(stdout)))
      } catch (e) {
        reject(e)
      }
    })
  })
}
