#!/usr/bin/env node
// Baixa os binários fixados em scripts/binaries.json para vendor/bin e confere o SHA-256.
// Uso: node scripts/fetch-binaries.mjs          (falha se o hash não conferir)
//      node scripts/fetch-binaries.mjs --lock   (grava o hash de entradas com sha256 vazio)
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'binaries.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const lock = process.argv.includes('--lock')
const vendor = join(root, 'vendor')
const bin = join(vendor, 'bin')
// tar do Windows (bsdtar) abre zip e 7z; o tar do Git Bash não abre zip.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar'
await mkdir(bin, { recursive: true })

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

let changed = false
for (const [name, entry] of Object.entries(manifest)) {
  const stamp = join(vendor, `${name}.sha256`)
  const present = entry.files.every((f) => existsSync(join(bin, f)))
  if (entry.sha256 && present && existsSync(stamp) && (await readFile(stamp, 'utf8')).trim() === entry.sha256) {
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
  const tmp = join(vendor, `${name}-tmp`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  const archive = join(tmp, `pacote${entry.url.slice(entry.url.lastIndexOf('.'))}`)
  await writeFile(archive, buf)
  execFileSync(tar, ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
  for (const f of entry.files) {
    const found = await findFile(tmp, f)
    if (!found) throw new Error(`${name}: ${f} não encontrado no pacote`)
    await copyFile(found, join(bin, f))
  }
  await rm(tmp, { recursive: true, force: true })
  await writeFile(stamp, entry.sha256)
  console.log(`${name}: ok (${entry.files.join(', ')})`)
}
if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
