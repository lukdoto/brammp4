#!/usr/bin/env node
// Baixa os binários fixados em scripts/binaries.json para vendor/ e confere o SHA-256 antes de usar.
// Tipos de entrada:
//   files:      extrai o pacote e copia só os arquivos listados para vendor/<dest ou "bin">/
//   extractAll: extrai o pacote inteiro (achatando uma única pasta raiz) para vendor/<dest>/; "probe" é um arquivo que deve existir depois
//   raw:        salva o arquivo baixado como está em vendor/<raw>
// Uso: node scripts/fetch-binaries.mjs          (falha se o hash não conferir)
//      node scripts/fetch-binaries.mjs --lock   (grava o hash de entradas com sha256 vazio)
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'binaries.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const lock = process.argv.includes('--lock')
const vendor = join(root, 'vendor')
// tar do Windows (bsdtar) abre zip e 7z; o tar do Git Bash não abre zip.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
await mkdir(vendor, { recursive: true })

async function findFile(dir, name) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const r = await findFile(p, name)
      if (r) return r
    } else if (e.name.toLowerCase() === name.toLowerCase()) return p
  }
  return null
}

function isPresent(entry) {
  if (entry.raw) return existsSync(join(vendor, entry.raw))
  if (entry.extractAll) return existsSync(join(vendor, entry.dest, entry.probe))
  return entry.files.every((f) => existsSync(join(vendor, entry.dest ?? 'bin', f)))
}

let changed = false
for (const [name, entry] of Object.entries(manifest)) {
  const stamp = join(vendor, `${name}.sha256`)
  if (entry.sha256 && isPresent(entry) && existsSync(stamp) && (await readFile(stamp, 'utf8')).trim() === entry.sha256) {
    console.log(`${name}: já presente`)
    continue
  }
  console.log(`${name}: baixando ${entry.url}`)
  const res = await fetch(entry.url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const sha = createHash('sha256').update(buf).digest('hex')
  if (!entry.sha256) {
    if (!lock) throw new Error(`${name}: sha256 vazio em binaries.json; rode com --lock uma vez e commite`)
    entry.sha256 = sha
    changed = true
  } else if (entry.sha256 !== sha) {
    throw new Error(`${name}: SHA-256 não confere (esperado ${entry.sha256}, obtido ${sha})`)
  }

  if (entry.raw) {
    const target = join(vendor, entry.raw)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buf)
    console.log(`${name}: ok (${entry.raw})`)
  } else {
    const tmp = join(vendor, `${name}-tmp`)
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    const archive = join(tmp, `pacote${entry.url.slice(entry.url.lastIndexOf('.'))}`)
    await writeFile(archive, buf)
    const out = join(tmp, 'x')
    await mkdir(out)
    execFileSync(tar, ['-xf', archive, '-C', out], { stdio: 'inherit' })
    if (entry.extractAll) {
      let src = out
      let top = await readdir(out, { withFileTypes: true })
      // o pacote oficial do mpv v0.41.0 é um zip que contém só outro zip: abre o interno também
      if (top.length === 1 && top[0].isFile() && top[0].name.toLowerCase().endsWith('.zip')) {
        const inner = join(tmp, 'inner')
        await mkdir(inner)
        execFileSync(tar, ['-xf', join(out, top[0].name), '-C', inner], { stdio: 'inherit' })
        src = inner
        top = await readdir(inner, { withFileTypes: true })
        if (top.length === 1 && top[0].isDirectory()) src = join(inner, top[0].name)
      } else if (top.length === 1 && top[0].isDirectory()) src = join(out, top[0].name)
      const target = join(vendor, entry.dest)
      // sem o carimbo, uma falha no meio da cópia não deixa a pasta parcial passar por "já presente"
      await rm(stamp, { force: true })
      await rm(target, { recursive: true, force: true })
      await cp(src, target, { recursive: true })
      if (!existsSync(join(target, entry.probe))) throw new Error(`${name}: ${entry.probe} não encontrado depois de extrair`)
      console.log(`${name}: ok (${entry.dest}/)`)
    } else {
      const dest = join(vendor, entry.dest ?? 'bin')
      await mkdir(dest, { recursive: true })
      for (const f of entry.files) {
        const found = await findFile(out, f)
        if (!found) throw new Error(`${name}: ${f} não encontrado no pacote`)
        await copyFile(found, join(dest, f))
      }
      console.log(`${name}: ok (${entry.files.join(', ')})`)
    }
    await rm(tmp, { recursive: true, force: true })
  }
  await writeFile(stamp, entry.sha256)
}
if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
