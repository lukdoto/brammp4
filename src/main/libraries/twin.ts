interface LibLike { id: string; label: string; rootPath: string; status: string }

const tailOf = (p: string): string | null => {
  const m = /^[A-Za-z]:(.*)$/.exec(p)
  if (!m) return null
  return m[1]!.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Biblioteca offline cujo caminho é o mesmo da pasta escolhida, ignorando letra do disco e caixa.
 * Serve para reaproveitar a biblioteca quando o arquivo de identificação (.brammp4.json) foi apagado.
 */
export function findOfflineTwin<T extends LibLike>(libs: T[], dir: string): T | undefined {
  const want = tailOf(dir)
  if (want === null) return undefined
  return libs.find((l) => l.status === 'offline' && tailOf(l.rootPath) === want)
}
