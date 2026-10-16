import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageCache, imageFileName, isSafeImageName, resolveImagePath } from '../../src/main/metadata/images'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brammp-img-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function imgResponse(bytes: number[] = [1, 2, 3], type = 'image/jpeg', status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } })
}

describe('imageFileName', () => {
  it('monta o nome do cache', () => {
    expect(imageFileName('w342', '/abc.jpg')).toBe('w342-abc.jpg')
    expect(imageFileName('w780', '/a_B-1.jpg')).toBe('w780-a_B-1.jpg')
  })
  it('rejeita caminhos fora do padrão', () => {
    for (const p of ['/../x.jpg', '/a/b.jpg', '/a.png', 'a.jpg', '', '/.jpg', '/a%2e.jpg', '//a.jpg', '/a.jpg/']) {
      expect(imageFileName('w342', p)).toBeUndefined()
    }
  })
})

describe('isSafeImageName', () => {
  it('aceita nomes válidos', () => {
    expect(isSafeImageName('w342-abc_D-1.jpg')).toBe(true)
    expect(isSafeImageName('w780-x.jpg')).toBe(true)
  })
  it('rejeita nomes hostis', () => {
    for (const n of ['../x.jpg', 'w342-a/b.jpg', 'w342-a\\b.jpg', 'w500-a.jpg', 'w342-a.png', '', 'w342-%2e%2e.jpg', 'w342-a.jpg\n', 'w342-.jpg']) {
      expect(isSafeImageName(n)).toBe(false)
    }
  })
})

describe('resolveImagePath', () => {
  it('resolve nome seguro para dentro da pasta', () => {
    expect(resolveImagePath(dir, 'brammp-img://img/w342-abc.jpg')).toBe(join(dir, 'w342-abc.jpg'))
  })
  it('rejeita traversal, codificação e outros hosts/esquemas', () => {
    for (const u of [
      'brammp-img://img/..%2f..%2fx.jpg',
      'brammp-img://img/%2e%2e/x.jpg',
      'brammp-img://img/w342-%61bc.jpg',
      'brammp-img://img/..%5cx.jpg',
      'brammp-img://img/w342-abc.jpg?x=1',
      'brammp-img://img/w342-abc.jpg#h',
      'brammp-img://img/sub/w342-abc.jpg',
      'brammp-img://img/',
      'brammp-img://img',
      'brammp-img://outro/w342-abc.jpg',
      'file:///w342-abc.jpg',
      'https://img/w342-abc.jpg',
      'brammp-img://img/%E0%A4%A.jpg',
      'não é url'
    ]) {
      expect(resolveImagePath(dir, u), u).toBeUndefined()
    }
  })
})

describe('createImageCache', () => {
  it('baixa de image.tmdb.org/t/p/w342/abc.jpg e grava w342-abc.jpg', async () => {
    const fetchFn = vi.fn(async () => imgResponse([9, 8, 7]))
    const cache = createImageCache({ dir, fetch: fetchFn as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/abc.jpg')).toBe('w342-abc.jpg')
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe('https://image.tmdb.org/t/p/w342/abc.jpg')
    expect([...readFileSync(join(dir, 'w342-abc.jpg'))]).toEqual([9, 8, 7])
    expect(readdirSync(dir)).toEqual(['w342-abc.jpg'])
  })

  it('segunda chamada não baixa de novo', async () => {
    const fetchFn = vi.fn(async () => imgResponse())
    const cache = createImageCache({ dir, fetch: fetchFn as unknown as typeof fetch })
    await cache.ensure('w780', '/x.jpg')
    expect(await cache.ensure('w780', '/x.jpg')).toBe('w780-x.jpg')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('cria a pasta se não existir', async () => {
    const sub = join(dir, 'a', 'b')
    const cache = createImageCache({ dir: sub, fetch: (async () => imgResponse()) as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/x.jpg')).toBe('w342-x.jpg')
    expect(existsSync(join(sub, 'w342-x.jpg'))).toBe(true)
  })

  it('404 devolve undefined e não deixa arquivo', async () => {
    const cache = createImageCache({ dir, fetch: (async () => imgResponse([1], 'image/jpeg', 404)) as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/abc.jpg')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('download que lança no meio não deixa arquivo parcial nem .tmp', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]))
      },
      pull() {
        throw new Error('conexão caiu')
      }
    })
    const fetchFn = async () => new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    const cache = createImageCache({ dir, fetch: fetchFn as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/abc.jpg')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('fetch que lança devolve undefined', async () => {
    const cache = createImageCache({
      dir,
      fetch: (async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch
    })
    expect(await cache.ensure('w342', '/abc.jpg')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('corpo vazio não vira arquivo', async () => {
    const cache = createImageCache({ dir, fetch: (async () => imgResponse([])) as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/abc.jpg')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('Content-Type que não é imagem não vira arquivo', async () => {
    const cache = createImageCache({ dir, fetch: (async () => imgResponse([1], 'text/html')) as unknown as typeof fetch })
    expect(await cache.ensure('w342', '/abc.jpg')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('caminho TMDB com .., barra extra ou extensão errada é rejeitado sem chamar fetch', async () => {
    const fetchFn = vi.fn(async () => imgResponse())
    const cache = createImageCache({ dir, fetch: fetchFn as unknown as typeof fetch })
    for (const p of ['/../x.jpg', '/a/b.jpg', '/a.png', '/..%2fx.jpg', '']) {
      expect(await cache.ensure('w342', p)).toBeUndefined()
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
