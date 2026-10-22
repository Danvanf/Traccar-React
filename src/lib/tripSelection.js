export function isTripSelected(selection, trip) {
  return !selection.excludedTripIds.includes(trip.tripId) &&
    (selection.days.includes(trip.dayKey) || selection.tripIds.includes(trip.tripId))
}

export function toggleTripSelection(selection, trip) {
  const selected = isTripSelected(selection, trip)
  if (selection.days.includes(trip.dayKey)) {
    return { ...selection, excludedTripIds: selected
      ? [...selection.excludedTripIds, trip.tripId]
      : selection.excludedTripIds.filter((id) => id !== trip.tripId) }
  }
  return { ...selection, tripIds: selected
    ? selection.tripIds.filter((id) => id !== trip.tripId)
    : [...selection.tripIds, trip.tripId] }
}
export function toggleDaySelection(selection, dayKey, trips) {
  const dayTrips = trips.filter((trip) => trip.dayKey === dayKey)
  const ids = new Set(dayTrips.map((trip) => trip.tripId))
  const allSelected = dayTrips.length > 0 ? dayTrips.every((trip) => isTripSelected(selection, trip)) : selection.days.includes(dayKey)
  return {
    days: allSelected ? selection.days.filter((key) => key !== dayKey) : [...new Set([...selection.days, dayKey])],
    tripIds: selection.tripIds.filter((id) => !ids.has(id)),
    excludedTripIds: selection.excludedTripIds.filter((id) => !ids.has(id)),
  }
}