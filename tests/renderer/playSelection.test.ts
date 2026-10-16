import { describe, expect, it } from 'vitest'
import { choiceToValue, valueToChoice } from '../../src/renderer/src/playSelection'

describe('playSelection', () => {
  it('ida e volta', () => {
    for (const c of [{ kind: 'off' as const }, { kind: 'embedded' as const, typeIndex: 3 }, { kind: 'external' as const, relPath: 'Dark/a: b.srt' }]) {
      expect(valueToChoice(choiceToValue(c))).toEqual(c)
    }
  })
  it('valores inválidos viram null', () => {
    for (const v of ['', 'e:', 'e:0', 'e:x', 'x:', 'z:1', 'embedded']) expect(valueToChoice(v)).toBeNull()
  })
})
