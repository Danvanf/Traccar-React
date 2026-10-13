export function isTelemetryPlaceholderValue(key, value, profile = null) {
  const info = profile?.getAttributeInfo?.(key)
  const candidates = [value, Number(value)].map((item) => String(item))
  if (info?.sentinelValues?.some((sentinel) => candidates.includes(String(sentinel)))) return true
  // Sentinel interpretation belongs to the selected protocol profile. A
  // global Teltonika assumption can discard valid values from other devices.
  return false
}

export function hasMeaningfulTelemetryValue(values, key, profile = null) {
  const numericValues = values.map(Number).filter(Number.isFinite)
  if (numericValues.length === 0) return false
  return numericValues.some((value) => value !== 0 && !isTelemetryPlaceholderValue(key, value, profile))
}
