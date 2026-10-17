function normalizeFieldText(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLocaleLowerCase()
    .trim()
}

const SENSITIVE_FIELD_PATTERN = /\b(?:vin|vehicle identification number|imei|iccid|imsi|serial number|serial no|password|passcode|secret|token|security key|api key|trip tag|tag name|driver id|user id|account id)\b/

export function formatTelemetrySample(fieldKey, mapping, sampleValue, { revealText = false } = {}) {
  if (sampleValue == null) return null

  const fieldDescription = normalizeFieldText(`${fieldKey ?? ''} ${mapping?.label ?? ''}`)
  const sensitive = mapping?.valueType === 'identifier' || SENSITIVE_FIELD_PATTERN.test(fieldDescription)
  if (sensitive) {
    return { text: 'Hidden sensitive value', hidden: true, revealable: false }
  }

  if (typeof sampleValue === 'string' && !revealText) {
    return {
      text: `Text value hidden (${sampleValue.length} characters)`,
      hidden: true,
      revealable: true,
    }
  }

  return { text: String(sampleValue), hidden: false, revealable: typeof sampleValue === 'string' }
}
