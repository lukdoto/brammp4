import { useEffect, useState } from 'react'
import type { TmdbStatus } from '../../../shared/types'
import { plural, tmdbKeyError } from '../format'

export const TMDB_ATTRIBUTION = 'Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.'

export function Settings({ refresh, onOpenLibraries }: { refresh: number; onOpenLibraries: () => void }) {
  const [status, setStatus] = useState<TmdbStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => window.api.getTmdbStatus().then(setStatus, () => {})
  useEffect(() => {
    void reload()
  }, [refresh])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.setTmdbKey(key.trim())
      if (r.ok) setKey('')
      else setError(tmdbKeyError(r.error))
    } catch {
      setError('Não foi possível salvar a chave.')
    } finally {
      setBusy(false)
      void reload()
    }
  }

  async function remove() {
    setError(null)
    try {
      await window.api.clearTmdbKey()
    } catch {
      setError('Não foi possível remover a chave.')
    }
    void reload()
  }

  return (
    <main>
      <h1>Configurações</h1>
      <h2>Metadados (TMDB)</h2>
      <p>
        Capas, sinopses e nomes de episódios vêm do TMDB. Para usar, crie uma conta gratuita em themoviedb.org e copie a
        chave em Configurações → API (a chave de API v3).
      </p>
      {status?.hasKey ? (
        <div className="add">
          <span className="badge done">Chave configurada</span>
          <button onClick={remove}>Remover</button>
        </div>
      ) : (
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim()) void save()
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Cole a chave de API do TMDB"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="primary" type="submit" disabled={busy || !key.trim()}>
            {busy ? 'Testando…' : 'Salvar e testar'}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {status && status.pending > 0 && (
        <p>
          {plural(status.pending, 'título aguardando', 'títulos aguardando')} identificação
          {status.syncing ? ' (buscando agora…)' : ''}
        </p>
      )}
      <h2>Bibliotecas</h2>
      <p>
        <button onClick={onOpenLibraries}>Gerenciar bibliotecas</button>
      </p>
      <p className="attribution">{TMDB_ATTRIBUTION}</p>
    </main>
  )
}
