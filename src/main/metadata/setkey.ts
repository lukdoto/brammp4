import type { SetKeyResult } from '../../shared/types'
import { setKeyError } from './results'

export interface SetKeyDeps {
  encryptionAvailable: () => boolean
  /** Confere a chave no TMDB (lança TmdbError). */
  validate: (key: string) => Promise<void>
  save: (key: string) => 'ok' | 'encryption-unavailable'
  /** Descarta o cliente guardado e avisa a rodada em andamento. */
  onKeyChanged: () => void
  sync: () => void
}

const MAX_KEY = 500

/**
 * Ordem importa: formato -> cifra disponível (antes de mandar a chave para a rede) -> validação
 * no TMDB -> gravação -> troca de cliente -> sincronização.
 */
export async function setTmdbKey(raw: unknown, deps: SetKeyDeps): Promise<SetKeyResult> {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (key === '' || key.length > MAX_KEY) return { ok: false, error: 'invalid' }
  if (!deps.encryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }
  try {
    await deps.validate(key)
  } catch (e) {
    return setKeyError(e)
  }
  try {
    if (deps.save(key) === 'encryption-unavailable') return { ok: false, error: 'encryption-unavailable' }
  } catch (err) {
    // só o nome: a mensagem poderia conter a chave
    console.error('[metadata] falha ao gravar a chave:', err instanceof Error ? err.name : 'erro')
    return { ok: false, error: 'encryption-unavailable' }
  }
  deps.onKeyChanged()
  deps.sync()
  return { ok: true }
}
