import type { PlayRequest, SubChoice } from '../../shared/types'

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

function parseSub(v: unknown): SubChoice | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (o.kind === 'off') return { kind: 'off' }
  if (o.kind === 'embedded' && isInt(o.typeIndex, 1, 999)) return { kind: 'embedded', typeIndex: o.typeIndex }
  if (o.kind === 'external' && typeof o.relPath === 'string' && o.relPath.length > 0 && o.relPath.length <= 1000) {
    return { kind: 'external', relPath: o.relPath }
  }
  return null
}

/** O que vem da interface é dado não confiável: só números e identificadores, nunca caminhos de arquivo. */
export function parsePlayRequest(raw: unknown): PlayRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.itemKey !== 'string' || r.itemKey.length === 0 || r.itemKey.length > 500) return null
  if (!isInt(r.fileId, 1, Number.MAX_SAFE_INTEGER)) return null
  if (typeof r.startS !== 'number' || !Number.isFinite(r.startS) || r.startS < 0 || r.startS > 1_000_000) return null
  const sel = r.selection
  if (typeof sel !== 'object' || sel === null) return null
  const s = sel as Record<string, unknown>
  const audio = s.audioTypeIndex
  if (audio !== null && !isInt(audio, 1, 999)) return null
  const sub = parseSub(s.sub)
  if (!sub) return null
  return { itemKey: r.itemKey, fileId: r.fileId, startS: r.startS, selection: { audioTypeIndex: audio as number | null, sub } }
}
