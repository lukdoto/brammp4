import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/schema'

describe('migrações', () => {
  it('banco novo chega na versão atual com titles.added_at', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const { user_version } = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
    expect(user_version).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT added_at FROM titles').all()).toEqual([])
  })

  it('banco do M1 (versão 1) é atualizado e títulos antigos ganham uma data', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(MIGRATIONS[0]!)
    db.exec('PRAGMA user_version = 1')
    db.prepare(`INSERT INTO titles (kind, local_key, name) VALUES ('movie', 'movie:x', 'X')`).run()
    migrate(db)
    const row = db.prepare('SELECT added_at FROM titles').get() as unknown as { added_at: string | null }
    expect(row.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
