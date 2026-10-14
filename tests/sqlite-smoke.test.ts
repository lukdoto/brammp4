import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('node:sqlite', () => {
  it('abre banco em memória e executa SQL', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'ok\')')
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'ok' })
  })
})
