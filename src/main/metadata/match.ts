import { slugify } from '../parser/keys'
import type { TmdbTitle } from './tmdb'

/** Prefere nome igual (sem acento/caixa) + ano; depois nome igual; senão o primeiro resultado. */
export function pickBest(results: TmdbTitle[], name: string, year?: number): TmdbTitle | undefined {
  const want = slugify(name)
  const same = results.filter((r) => slugify(r.name) === want)
  if (year !== undefined) {
    const exact = same.find((r) => r.year === year)
    if (exact) return exact
  }
  return same[0] ?? results[0]
}
