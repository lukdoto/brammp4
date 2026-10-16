import { useEffect, useState } from 'react'
import type { PlayError, PlayOptions } from '../../../shared/types'
import { audioLabel, codecLabel, formatClock, itemLabel, resolutionLabel, subLabel } from '../format'
import { choiceToValue, valueToChoice } from '../playSelection'

const ERRORS: Record<PlayError, string> = {
  invalid: 'Pedido inválido. Feche e tente de novo.',
  'already-playing': 'Já existe um vídeo em reprodução. Feche o player antes de abrir outro.',
  offline: 'O disco desta biblioteca está desconectado. Conecte-o e tente de novo.',
  'missing-file': 'O arquivo não foi encontrado. Revarra a biblioteca em Bibliotecas.',
  'mpv-missing': 'O reprodutor não foi encontrado. Reinstale o brammp4.',
  'start-failed': 'Não foi possível iniciar o reprodutor.'
}

export function PlayPanel({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const [opts, setOpts] = useState<PlayOptions | null | undefined>(undefined)
  const [fileId, setFileId] = useState<number | null>(null)
  const [audio, setAudio] = useState('')
  const [sub, setSub] = useState('off')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function pickFile(o: PlayOptions, id: number | null): void {
    setFileId(id)
    const f = o.files.find((x) => x.fileId === id)
    setAudio(f?.defaults.audioTypeIndex != null ? String(f.defaults.audioTypeIndex) : '')
    setSub(f ? choiceToValue(f.defaults.sub) : 'off')
  }

  useEffect(() => {
    let cancelled = false
    window.api.getPlayOptions(itemKey).then(
      (o) => {
        if (cancelled) return
        setOpts(o)
        if (o) pickFile(o, o.defaultFileId ?? o.files[0]?.fileId ?? null)
      },
      () => !cancelled && setOpts(null)
    )
    return () => {
      cancelled = true
    }
  }, [itemKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = opts?.files.find((f) => f.fileId === fileId)
  const versions = opts?.files.filter((f) => f.available) ?? []

  async function start(startS: number): Promise<void> {
    if (!opts || !file) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.play({
        itemKey,
        fileId: file.fileId,
        startS,
        selection: { audioTypeIndex: audio === '' ? null : Number(audio), sub: valueToChoice(sub) ?? { kind: 'off' } }
      })
      if (r.ok) onClose()
      else setError(ERRORS[r.error])
    } catch {
      setError(ERRORS['start-failed'])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Painel de play">
        {opts === undefined && <p>Carregando…</p>}
        {opts === null && (
          <>
            <p>Este item não está mais no catálogo.</p>
            <button onClick={onClose}>Fechar</button>
          </>
        )}
        {opts && (
          <>
            <h2>{opts.titleName}</h2>
            <div className="meta">
              {opts.kind === 'series' ? `${itemLabel(opts.season, opts.episode)}${opts.episodeName ? ` · ${opts.episodeName}` : ''}` : 'Filme'}
            </div>

            {opts.defaultFileId === null && (
              <p className="error">O disco desta biblioteca está desconectado. Conecte-o para assistir.</p>
            )}

            {versions.length > 1 && (
              <label className="field">
                Versão
                <select value={fileId ?? ''} onChange={(e) => pickFile(opts, Number(e.target.value))}>
                  {versions.map((f) => (
                    <option key={f.fileId} value={f.fileId}>
                      {[resolutionLabel(f.height), codecLabel(f.videoCodec), f.libraryLabel].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {file && (
              <>
                <label className="field">
                  Áudio
                  <select value={audio} onChange={(e) => setAudio(e.target.value)} disabled={file.audio.length === 0}>
                    {file.audio.length === 0 && <option value="">Padrão do arquivo</option>}
                    {file.audio.map((a) => (
                      <option key={a.typeIndex} value={String(a.typeIndex)}>{audioLabel(a)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Legenda
                  <select value={sub} onChange={(e) => setSub(e.target.value)}>
                    <option value="off">Desligada</option>
                    {file.subs.map((s) => {
                      const value = choiceToValue(s.source === 'embedded' ? { kind: 'embedded', typeIndex: s.typeIndex ?? 1 } : { kind: 'external', relPath: s.externalPath ?? '' })
                      return <option key={value} value={value}>{subLabel(s)}</option>
                    })}
                  </select>
                </label>
              </>
            )}

            {error && <p className="error">{error}</p>}

            <div className="actions">
              {opts.resumeFromS > 0 ? (
                <>
                  <button className="primary" disabled={busy || !file?.available} onClick={() => void start(opts.resumeFromS)}>
                    Continuar de {formatClock(opts.resumeFromS)}
                  </button>
                  <button disabled={busy || !file?.available} onClick={() => void start(0)}>Começar do início</button>
                </>
              ) : (
                <button className="primary" disabled={busy || !file?.available} onClick={() => void start(0)}>Assistir</button>
              )}
              <button onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
