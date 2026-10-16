import type { SubChoice } from '../../shared/types'

/** O <select> de legenda guarda texto; estas duas funções traduzem para a escolha tipada e de volta. */
export function choiceToValue(c: SubChoice): string {
  return c.kind === 'off' ? 'off' : c.kind === 'embedded' ? `e:${c.typeIndex}` : `x:${c.relPath}`
}

export function valueToChoice(v: string): SubChoice | null {
  if (v === 'off') return { kind: 'off' }
  if (v.startsWith('e:')) {
    const n = Number(v.slice(2))
    return Number.isInteger(n) && n >= 1 ? { kind: 'embedded', typeIndex: n } : null
  }
  if (v.startsWith('x:') && v.length > 2) return { kind: 'external', relPath: v.slice(2) }
  return null
}
