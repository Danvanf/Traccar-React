export function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)

  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours}h`
  if (mins > 0) return `${mins}m`
  return `${totalSec}s`
}

export function formatDistance(meters) {
  return `${Math.round((Number(meters) || 0) / 1609.344)} mi`
}
