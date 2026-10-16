export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Espera até `cond()` ser verdadeira; falha com erro claro se estourar o tempo. */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: tempo esgotado')
    await sleep(5)
  }
}
