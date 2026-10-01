export function isTelemetryPlaceholderValue(key, value, profile = null) {
  const info = profile?.getAttributeInfo(key)
  const candidates = [value, Number(value)].map((item) => String(item))
  if (info?.sentinelValues?.some((sentinel) => candidates.includes(String(sentinel)))) return true
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return false
  // Teltonika commonly uses the maximum unsigned values for absent sensor
  // readings. The official FMB003 table documents 255 for one-byte fields and
  // 65535 for two-byte fields; 65536 is accepted defensively from integrations
  // that widen the raw value before storing it.
  return numeric === 255 || numeric === 65535 || numeric === 65536
}

export function hasMeaningfulTelemetryValue(values, key, profile = null) {
  const numericValues = values.map(Number).filter(Number.isFinite)
  if (numericValues.length === 0) return false
  return numericValues.some((value) => value !== 0 && !isTelemetryPlaceholderValue(key, value, profile))
}
