/**
 * Junta chamadas próximas: dispara `wait` ms depois da última, mas nunca espera mais que
 * `maxWait` ms desde a primeira chamada ainda não atendida (rodadas longas ainda atualizam a tela).
 */
export function debounce(fn: () => void, wait: number, maxWait: number): { call(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt: number | null = null

  const fire = () => {
    timer = null
    firstAt = null
    fn()
  }

  return {
    call() {
      const now = Date.now()
      if (firstAt === null) firstAt = now
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, Math.max(0, Math.min(wait, firstAt + maxWait - now)))
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      firstAt = null
    }
  }
}
