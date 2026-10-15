import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function findFfprobe(): string | null {
  const vendored = join(process.cwd(), 'vendor', 'bin', 'ffprobe.exe')
  if (existsSync(vendored)) return vendored
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return 'ffprobe'
  } catch {
    return null
  }
}
