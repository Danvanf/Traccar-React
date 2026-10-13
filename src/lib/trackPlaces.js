import { metersBetween } from './geo.js'

function distanceMetersBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  if (![latitudeA, longitudeA, latitudeB, longitudeB].every((value) => Number.isFinite(Number(value)))) return null
  return metersBetween(Number(latitudeA), Number(longitudeA), Number(latitudeB), Number(longitudeB))
}

// A named-place passage is represented by the median timestamp among the
// consecutive route points inside that place's radius.
export function addNamedPlaceMarkers(points, namedPlaces, groups, fallbackVehicleId = null) {
  if (!namedPlaces?.length) return points
  const annotated = points.map((point) => {
    const group = groups[point.__groupIndex]
    const vehicleId = group?.vehicleId || fallbackVehicleId
    const matches = namedPlaces
      .filter((place) => (!place.vehicleId || !vehicleId || String(place.vehicleId) === String(vehicleId)) && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
      .map((place) => ({ place, distance: distanceMetersBetween(Number(point.latitude), Number(point.longitude), Number(place.latitude), Number(place.longitude)) }))
      .filter(({ place, distance }) => distance <= Math.max(1, Number(place.radiusMeters) || 1))
      .sort((a, b) => a.distance - b.distance)
    const namedMatch = (place) => {
      const name = String(place.name || '').trim()
      const track = String(place.trackName || '').trim()
      return { name: track ? `${track} / ${name}` : name, track, role: place.placeType || 'general' }
    }
    const placeMatches = matches.map(({ place }) => namedMatch(place)).filter(({ name }) => name)
    return { ...point, placeName: placeMatches.map(({ name }) => name).join('; '), placeTrack: [...new Set(placeMatches.map(({ track }) => track).filter(Boolean))].join('; '), placeRole: [...new Set(placeMatches.map(({ role }) => role).filter(Boolean))].join('; '), __placeMatches: placeMatches }
  })
  const eventsByIndex = new Map()
  const appendEvent = (index, event) => eventsByIndex.set(index, [...(eventsByIndex.get(index) || []), event])
  const groupIndexes = new Map()
  annotated.forEach((point, index) => groupIndexes.set(point.__groupIndex, [...(groupIndexes.get(point.__groupIndex) || []), index]))
  groupIndexes.forEach((indexes) => {
    const placeNames = new Set(indexes.flatMap((index) => annotated[index].__placeMatches.map((match) => match.name)))
    placeNames.forEach((placeName) => {
      let run = []
      const finishRun = () => {
        if (!run.length) return
        const middleTime = (run[0].timestamp.getTime() + run.at(-1).timestamp.getTime()) / 2
        const representative = run.reduce((closest, point) => Math.abs(point.timestamp.getTime() - middleTime) < Math.abs(closest.timestamp.getTime() - middleTime) ? point : closest, run[0])
        const role = representative.__placeMatches.find((match) => match.name === placeName)?.role || 'general'
        appendEvent(representative.__index, `enter:${role}:${placeName}`)
        const nextIndex = indexes[indexes.indexOf(run.at(-1).__index) + 1]
        if (nextIndex != null) appendEvent(nextIndex, `exit:${role}:${placeName}`)
        run = []
      }
      indexes.forEach((index) => {
        if (annotated[index].__placeMatches.some((match) => match.name === placeName)) run.push({ ...annotated[index], __index: index })
        else finishRun()
      })
      finishRun()
    })
  })
  return annotated.map((point, index) => {
    const { __placeMatches, ...cleanPoint } = point
    return { ...cleanPoint, placeEvent: (eventsByIndex.get(index) || []).join('; ') }
  })
}
