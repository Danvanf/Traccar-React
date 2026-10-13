const GROUPS = [
  { id: 'engine-air', label: 'Engine and air' },
  { id: 'fuel-emissions', label: 'Fuel and emissions' },
  { id: 'vehicle-motion', label: 'Vehicle movement' },
  { id: 'gnss-location', label: 'GNSS and location' },
  { id: 'diagnostics-service', label: 'Diagnostics and service' },
  { id: 'electrical-tracker', label: 'Electrical and tracker' },
  { id: 'connectivity-identity', label: 'Connectivity and identity' },
  { id: 'ble-sensors', label: 'BLE and external sensors' },
  { id: 'other', label: 'Other / unclassified' },
]

function textOf(...values) {
  return values.filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase()
}

export function getProfileFieldGroup(key, mapping = {}) {
  const override = mapping.systemGroup
  if (typeof override === 'string' && override.trim()) {
    const found = GROUPS.find((group) => group.id === override)
    return found || { id: override, label: override.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()) }
  }

  const label = textOf(mapping.label)
  const details = textOf(mapping.quantity, mapping.sourceKey, key)
  const combined = `${label} ${details}`

  if (/\b(vin|vehicle identification|serial number|imei|can program id|can module id)\b/.test(label)) return GROUPS[6]
  if (/\b(ble|bluetooth|humidity|external sensor)\b/.test(combined)) return GROUPS[7]
  if (/\b(gps|gnss|satellite|hdop|pdop|position dilution)\b/.test(combined)) return GROUPS[3]
  if (/\b(dtc|diagnostic|fault code|mil on|codes cleared|service interval|distance until service)\b/.test(combined)) return GROUPS[4]
  if (/\b(fuel|egr|emission|trim|equivalence ratio|injection|injector)\b/.test(label)) return GROUPS[1]
  if (/\b(engine|coolant|intake|manifold|mass air|throttle|rpm|timing advance|engine runtime|absolute load|barometric pressure)\b/.test(label)) return GROUPS[0]
  if (/\b(accelerometer|axis|speed|distance|mileage|odometer|eco score|driving)\b/.test(label) || /^(distance|odometer)$/.test(key)) return GROUPS[2]
  if (/\b(battery|voltage|current|power|ignition|motion|sleep mode)\b/.test(label)) return GROUPS[5]
  if (/\b(gsm|cell id|operator|signal|rssi|packet|priority|event)\b/.test(combined)) return GROUPS[6]

  return GROUPS[8]
}

export function getProfileFieldGroups(attributeMap = {}) {
  const customGroups = new Map()
  const fields = Object.entries(attributeMap).map(([key, mapping]) => {
    const group = getProfileFieldGroup(key, mapping || {})
    if (!GROUPS.some((known) => known.id === group.id)) customGroups.set(group.id, group)
    return { key, mapping: mapping || {}, group }
  })
  return { groups: [...GROUPS, ...customGroups.values()], fields }
}
