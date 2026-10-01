export function metersBetween(lat1, lon1, lat2, lon2) {
  const r = 6371e3
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return r * c
}

export function toHistoryPosition(position) {
  return {
    positionId: position.id ?? null,
    deviceId: position.deviceId,
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: new Date(position.fixTime || position.deviceTime || position.serverTime || Date.now()),
    speed: position.speed ?? 0,
    course: position.course,
    accuracy: position.accuracy,
    altitude: position.altitude,
    attributes: position.attributes || {},
  }
}
