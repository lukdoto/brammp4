export function ProgressBar({ ratio, watched }: { ratio: number; watched?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div className="pbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={watched ? 'fill done' : 'fill'} style={{ width: `${pct}%` }} />
    </div>
  )
}
