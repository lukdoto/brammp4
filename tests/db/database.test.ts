import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'

describe('openDatabase', () => {
  it('em arquivo: WAL com synchronous = FULL (cada gravação de progresso sobrevive a um corte de energia)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brammp4-db-'))
    try {
      const db = openDatabase(join(dir, 'brammp4.db'))
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 }) // 2 = FULL
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
