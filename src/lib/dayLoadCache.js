// Track completed point days separately from requests for the current selection.
export function createDayLoadCache(loadedDays = new Set()) {
  const pending = new Map()
  let generation = 0
  const isCurrent = (request) => request.generation === null || request.generation === generation
  const ownsPendingDay = (request) => isCurrent(request) && pending.get(request.day) === request

  return {
    reserve(day, { selection = true } = {}) {
      if (loadedDays.has(day) || pending.has(day)) return null
      const request = { day, generation: selection ? generation : null }
      pending.set(day, request)
      return request
    },
    isCurrent,
    complete(request) {
      if (!ownsPendingDay(request)) return false
      loadedDays.add(request.day)
      pending.delete(request.day)
      return true
    },
    fail(request) {
      if (!ownsPendingDay(request)) return false
      pending.delete(request.day)
      return true
    },
    invalidate() {
      generation += 1
      for (const [day, request] of pending) {
        if (request.generation !== null) pending.delete(day)
      }
    },
  }
}