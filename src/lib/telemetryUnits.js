const unitGroups = [
  {
    quantity: 'temperature',
    label: 'Temperature',
    canonicalUnit: '°C',
    units: [
      { symbol: '°C', label: 'Degrees Celsius (°C)', scale: 1, offset: 0 },
      { symbol: '0.01 °C', label: 'Hundredths of a degree Celsius (0.01 °C)', scale: 0.01, offset: 0 },
      { symbol: '0.1 °C', label: 'Tenths of a degree Celsius (0.1 °C)', scale: 0.1, offset: 0 },
      { symbol: '°F', label: 'Degrees Fahrenheit (°F)', scale: 5 / 9, offset: -160 / 9 },
      { symbol: 'degF', label: 'Degrees Fahrenheit (degF)', scale: 5 / 9, offset: -160 / 9 },
    ],
  },
  {
    quantity: 'pressure',
    label: 'Pressure',
    canonicalUnit: 'kPa',
    units: [
      { symbol: 'kPa', label: 'Kilopascals (kPa)', scale: 1, offset: 0 },
      { symbol: 'psi', label: 'Pounds per square inch (psi)', scale: 6.894757293168, offset: 0 },
      { symbol: 'inHg', label: 'Inches of mercury (inHg)', scale: 3.386389, offset: 0 },
      { symbol: 'bar', label: 'Bar (bar)', scale: 100, offset: 0 },
      { symbol: '0.1 kPa', label: 'Tenths of a kilopascal (0.1 kPa)', scale: 0.1, offset: 0 },
      { symbol: '10 kPa', label: 'Ten kilopascals per unit (10 kPa)', scale: 10, offset: 0 },
    ],
  },
  {
    quantity: 'voltage',
    label: 'Voltage',
    canonicalUnit: 'V',
    units: [
      { symbol: 'V', label: 'Volts (V)', scale: 1, offset: 0 },
      { symbol: '0.01 V', label: 'Hundredths of a volt (0.01 V)', scale: 0.01, offset: 0 },
      { symbol: '0.1 V', label: 'Tenths of a volt (0.1 V)', scale: 0.1, offset: 0 },
      { symbol: 'mV', label: 'Millivolts (mV)', scale: 0.001, offset: 0 },
    ],
  },
  {
    quantity: 'current',
    label: 'Electrical current',
    canonicalUnit: 'A',
    units: [
      { symbol: 'A', label: 'Amperes (A)', scale: 1, offset: 0 },
      { symbol: '0.1 A', label: 'Tenths of an ampere (0.1 A)', scale: 0.1, offset: 0 },
      { symbol: 'mA', label: 'Milliamperes (mA)', scale: 0.001, offset: 0 },
    ],
  },
  {
    quantity: 'speed',
    label: 'Speed',
    canonicalUnit: 'km/h',
    units: [
      { symbol: 'km/h', label: 'Kilometres per hour (km/h)', scale: 1, offset: 0 },
      { symbol: 'mph', label: 'Miles per hour (mph)', scale: 1.609344, offset: 0 },
    ],
  },
  {
    quantity: 'distance',
    label: 'Distance',
    canonicalUnit: 'm',
    units: [
      { symbol: 'm', label: 'Metres (m)', scale: 1, offset: 0 },
      { symbol: 'km', label: 'Kilometres (km)', scale: 1000, offset: 0 },
      { symbol: 'mi', label: 'Miles (mi)', scale: 1609.344, offset: 0 },
    ],
  },
  {
    quantity: 'fuel_volume',
    label: 'Fuel volume',
    canonicalUnit: 'L',
    units: [
      { symbol: 'L', label: 'Litres (L)', scale: 1, offset: 0 },
      { symbol: 'gal', label: 'US gallons (gal)', scale: 3.785411784, offset: 0 },
      { symbol: '0.001 L', label: 'Millilitres (0.001 L)', scale: 0.001, offset: 0 },
      { symbol: '0.1 L', label: 'Tenths of a litre (0.1 L)', scale: 0.1, offset: 0 },
    ],
  },
  {
    quantity: 'fuel_flow',
    label: 'Fuel flow',
    canonicalUnit: 'L/h',
    units: [
      { symbol: 'L/h', label: 'Litres per hour (L/h)', scale: 1, offset: 0 },
      { symbol: 'gal/h', label: 'US gallons per hour (gal/h)', scale: 3.785411784, offset: 0 },
      { symbol: '0.01 L/h', label: 'Hundredths of a litre per hour (0.01 L/h)', scale: 0.01, offset: 0 },
      { symbol: 'cL/h', label: 'Centilitres per hour (cL/h)', scale: 0.01, offset: 0 },
    ],
  },
  {
    quantity: 'mass_flow',
    label: 'Mass flow',
    canonicalUnit: 'g/s',
    units: [
      { symbol: 'g/s', label: 'Grams per second (g/s)', scale: 1, offset: 0 },
      { symbol: 'lb/min', label: 'Pounds per minute (lb/min)', scale: 7.559872, offset: 0 },
      { symbol: '0.01 g/s', label: 'Hundredths of a gram per second (0.01 g/s)', scale: 0.01, offset: 0 },
    ],
  },
  {
    quantity: 'percent',
    label: 'Percentage',
    canonicalUnit: '%',
    units: [{ symbol: '%', label: 'Percent (%)', scale: 1, offset: 0 }],
  },
  {
    quantity: 'relative_humidity',
    label: 'Relative humidity',
    canonicalUnit: '%RH',
    units: [
      { symbol: '%RH', label: 'Percent relative humidity (%RH)', scale: 1, offset: 0 },
      { symbol: '0.1 %RH', label: 'Tenths of a percent relative humidity (0.1 %RH)', scale: 0.1, offset: 0 },
    ],
  },
  {
    quantity: 'acceleration',
    label: 'Acceleration',
    canonicalUnit: 'mg',
    units: [
      { symbol: 'mg', label: 'Milli-g (mg)', scale: 1, offset: 0 },
      { symbol: 'mG', label: 'Milli-g (mG)', scale: 1, offset: 0 },
      { symbol: 'g', label: 'Standard gravity (g)', scale: 1000, offset: 0 },
    ],
  },
  {
    quantity: 'duration',
    label: 'Duration',
    canonicalUnit: 's',
    units: [
      { symbol: 's', label: 'Seconds (s)', scale: 1, offset: 0 },
      { symbol: 'ms', label: 'Milliseconds (ms)', scale: 0.001, offset: 0 },
      { symbol: 'min', label: 'Minutes (min)', scale: 60, offset: 0 },
      { symbol: 'h', label: 'Hours (h)', scale: 3600, offset: 0 },
    ],
  },
  {
    quantity: 'engine_speed',
    label: 'Rotational speed',
    canonicalUnit: 'rpm',
    units: [{ symbol: 'rpm', label: 'Revolutions per minute (rpm)', scale: 1, offset: 0 }],
  },
  {
    quantity: 'angle',
    label: 'Angle',
    canonicalUnit: 'deg',
    units: [
      { symbol: '0.01 deg', label: 'Hundredths of a degree (0.01 deg)', scale: 0.01, offset: 0 },
      { symbol: 'deg', label: 'Degrees (deg)', scale: 1, offset: 0 },
      { symbol: 'degree', label: 'Degrees (degree)', scale: 1, offset: 0 },
    ],
  },
  {
    quantity: 'fuel_economy',
    label: 'Fuel economy',
    canonicalUnit: 'L/100km',
    units: [
      { symbol: 'L/100km', label: 'Litres per 100 kilometres (L/100km)', scale: 1, offset: 0 },
      { symbol: '0.01 L/100km', label: 'Hundredths of a litre per 100 kilometres (0.01 L/100km)', scale: 0.01, offset: 0 },
    ],
  },
  {
    "quantity": "ratio",
    "label": "Dimensionless ratio",
    "canonicalUnit": "ratio",
    "units": [
      {
        "symbol": "ratio",
        "label": "Dimensionless ratio",
        "scale": 1,
        "offset": 0
      },
      {
        "symbol": "0.1 ratio",
        "label": "Tenths of a ratio (0.1)",
        "scale": 0.1,
        "offset": 0
      },
      {
        "symbol": "0.01 ratio",
        "label": "Hundredths of a ratio (0.01)",
        "scale": 0.01,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "count",
    "label": "Count",
    "canonicalUnit": "count",
    "units": [
      {
        "symbol": "count",
        "label": "Count",
        "scale": 1,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "energy",
    "label": "Energy",
    "canonicalUnit": "kWh",
    "units": [
      {
        "symbol": "kWh",
        "label": "Kilowatt-hours (kWh)",
        "scale": 1,
        "offset": 0
      },
      {
        "symbol": "0.01 kWh",
        "label": "Hundredths of a kilowatt-hour (0.01 kWh)",
        "scale": 0.01,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "energy_consumption",
    "label": "Energy consumption",
    "canonicalUnit": "kWh/100km",
    "units": [
      {
        "symbol": "kWh/100km",
        "label": "Kilowatt-hours per 100 kilometres (kWh/100km)",
        "scale": 1,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "distance_per_fuel",
    "label": "Distance per fuel volume",
    "canonicalUnit": "km/L",
    "units": [
      {
        "symbol": "km/L",
        "label": "Kilometres per litre (km/L)",
        "scale": 1,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "length",
    "label": "Sensor level / length",
    "canonicalUnit": "mm",
    "units": [
      {
        "symbol": "mm",
        "label": "Millimetres (mm)",
        "scale": 1,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "frequency",
    "label": "Frequency",
    "canonicalUnit": "Hz",
    "units": [
      {
        "symbol": "Hz",
        "label": "Hertz (Hz)",
        "scale": 1,
        "offset": 0
      },
      {
        "symbol": "0.1 Hz",
        "label": "Tenths of a hertz (0.1 Hz)",
        "scale": 0.1,
        "offset": 0
      }
    ]
  },
  {
    "quantity": "illuminance",
    "label": "Illuminance",
    "canonicalUnit": "lx",
    "units": [
      {
        "symbol": "lx",
        "label": "Lux (lx)",
        "scale": 1,
        "offset": 0
      }
    ]
  },

]

const groupsByQuantity = new Map(unitGroups.map((group) => [group.quantity, group]))
const unitsBySymbol = new Map(unitGroups.flatMap((group) => group.units.map((unit) => [unit.symbol, { ...unit, quantity: group.quantity, canonicalUnit: group.canonicalUnit }])))

export const TELEMETRY_QUANTITY_OPTIONS = [
  ...unitGroups.map(({ quantity, label }) => ({ value: quantity, label })),
  { value: 'state', label: 'State or flag' },
  { value: 'identifier', label: 'Identifier' },
  { value: 'text', label: 'Text' },
  { value: 'unknown', label: 'Unknown' },
]

export function getTelemetryUnitGroup(quantity) {
  return groupsByQuantity.get(quantity) || null
}

export function getTelemetryUnit(symbol) {
  return unitsBySymbol.get(symbol) || null
}

export function getTelemetryUnitGroupForSymbol(symbol) {
  const unit = getTelemetryUnit(symbol)
  return unit ? getTelemetryUnitGroup(unit.quantity) : null
}

export function getTelemetryUnitGroups() {
  return unitGroups.map(({ quantity, label, canonicalUnit, units }) => ({
    quantity,
    label,
    canonicalUnit,
    units: units.map((unit) => ({ ...unit })),
  }))
}

export function getDisplayUnitDefinition(quantity, canonicalUnit, displayUnit, unitSystem = 'imperial') {
  const group = getTelemetryUnitGroup(quantity) || getTelemetryUnitGroupForSymbol(canonicalUnit)
  if (!group || group.canonicalUnit !== canonicalUnit) return null
  const preferred = displayUnit
    || (unitSystem === 'metric'
      ? group.units.find((unit) => ['kPa', '°C', 'km/h', 'km', 'L', 'L/h', 'g/s'].includes(unit.symbol))
      : group.units.find((unit) => ['psi', 'inHg', '°F', 'mph', 'mi', 'gal', 'gal/h', 'g/s'].includes(unit.symbol)))
    || group.units[0]
  const selected = typeof preferred === 'string' ? group.units.find((unit) => unit.symbol === preferred) : preferred
  if (!selected) return null
  return {
    ...selected,
    displayScale: 1 / selected.scale,
    displayOffset: -selected.offset / selected.scale,
  }
}

export function compatibleTelemetryUnits(quantity) {
  return getTelemetryUnitGroup(quantity)?.units.map((unit) => ({ ...unit })) || []
}
