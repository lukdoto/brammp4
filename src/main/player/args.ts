import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function newPipePath(): string {
  const id = randomBytes(6).toString('hex')
  return process.platform === 'win32' ? `\\\\.\\pipe\\brammp4-${id}` : join(tmpdir(), `brammp4-${id}.sock`)
}

export interface MpvLaunch {
  pipePath: string
  configDir: string
  filePath: string
  title: string
  startS: number
  audioId: number | null
  /** número = legenda embutida; 'no' = desligada; null = deixa o mpv/uosc decidir (externa é aplicada depois do file-loaded) */
  sid: number | 'no' | null
  /** caminhos absolutos; todas entram no menu do uosc */
  externalSubs: string[]
}

/** Sempre em array (sem shell). O arquivo vai depois de "--" para nunca ser lido como opção. */
export function buildMpvArgs(l: MpvLaunch): string[] {
  const args = [
    `--input-ipc-server=${l.pipePath}`,
    `--config-dir=${l.configDir}`,
    '--fullscreen',
    '--force-window=yes',
    '--osc=no',
    '--osd-bar=no',
    '--border=no',
    '--keep-open=no',
    // o mpv expande ${...} e escapes no título; tira o que poderia virar expressão
    `--title=${l.title.replace(/[$\\]/g, '')}`
  ]
  if (l.startS > 0) args.push(`--start=${l.startS.toFixed(3)}`)
  if (l.audioId !== null) args.push(`--aid=${l.audioId}`)
  if (l.sid === 'no') args.push('--sid=no')
  else if (l.sid !== null) args.push(`--sid=${l.sid}`)
  for (const s of l.externalSubs) args.push(`--sub-file=${s}`)
  args.push('--', l.filePath)
  return args
}
