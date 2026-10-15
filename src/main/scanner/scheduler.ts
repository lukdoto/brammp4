/**
 * Uma varredura por biblioteca por vez. Pedido feito durante uma varredura devolve a mesma
 * promessa e agenda exatamente uma nova varredura ao terminar (o endereço da biblioteca
 * pode ter mudado no meio do caminho, então a nova execução relê o estado atual).
 */
export function createScanScheduler<T>(run: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const running = new Map<string, Promise<T>>()
  const rerun = new Set<string>()

  const start = (id: string): Promise<T> => {
    const job = Promise.resolve()
      .then(() => run(id))
      .finally(() => {
        running.delete(id)
        if (rerun.delete(id)) start(id).catch((err) => console.error('[scan] falhou', id, err))
      })
    running.set(id, job)
    return job
  }

  return (id) => {
    const current = running.get(id)
    if (current) {
      rerun.add(id)
      return current
    }
    return start(id)
  }
}
