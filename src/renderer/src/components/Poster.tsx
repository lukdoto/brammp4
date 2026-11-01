import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { imageUrl } from '../format'

function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join('')
}

export function posterStyle(name: string): CSSProperties {
  const h = hue(name)
  return { background: `linear-gradient(160deg, hsl(${h} 45% 35%), hsl(${(h + 40) % 360} 50% 15%))` }
}

/** Capa do TMDB quando houver e carregar; senão o placeholder (iniciais + cor por nome). */
export function Poster({ name, posterFile }: { name: string; posterFile?: string }) {
  const url = imageUrl(posterFile)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (url && !failed) {
    return (
      <div className="poster has-image">
        <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} />
      </div>
    )
  }
  return <div className="poster" style={posterStyle(name)}>{initials(name)}</div>
}
