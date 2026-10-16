export const WATCHED_RATIO = 0.9
export const WATCHED_REMAINING_S = 120
export const RESUME_MIN_S = 30
export const RESUME_BACK_S = 5

/**
 * 90% ou mais do vídeo, ou faltando menos de 2 min depois da metade.
 * A regra dos 2 min não vale antes da metade: um clipe de 100 s não pode nascer "assistido".
 */
export function isWatched(positionS: number, durationS?: number): boolean {
  if (durationS === undefined || !Number.isFinite(durationS) || durationS <= 0) return false
  if (positionS >= durationS * WATCHED_RATIO) return true
  return positionS >= durationS * 0.5 && durationS - positionS < WATCHED_REMAINING_S
}

/** De onde "Continuar" começa: 0 se não há o que continuar, senão 5 s antes do ponto salvo. */
export function resumeStart(positionS: number | undefined, watched: boolean): number {
  if (watched || positionS === undefined || !Number.isFinite(positionS) || positionS < RESUME_MIN_S) return 0
  return Math.max(0, positionS - RESUME_BACK_S)
}

export interface OrderedItem {
  key: string
  season: number | null
  episode: number | null
  available: boolean
}

function compareItems(a: OrderedItem, b: OrderedItem): number {
  const sa = a.season ?? Number.MAX_SAFE_INTEGER
  const sb = b.season ?? Number.MAX_SAFE_INTEGER
  if (sa !== sb) return sa - sb
  return (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER)
}

/** O menor (temporada, episódio) depois do atual que tenha arquivo disponível. */
export function nextAvailable<T extends OrderedItem>(items: T[], currentKey: string): T | undefined {
  const sorted = [...items].sort(compareItems)
  const i = sorted.findIndex((x) => x.key === currentKey)
  if (i < 0) return undefined
  return sorted.slice(i + 1).find((x) => x.available)
}
