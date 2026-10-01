export const STATUS_CARD_FIELDS = [
  ['fuelLevel', 'Fuel level'],
  ['engineRpm', 'Engine RPM'],
  ['power', 'Power'],
  ['coolant', 'Coolant'],
  ['engineRuntime', 'Engine runtime'],
  ['maf', 'Mass Air Flow'],
  ['intakeAir', 'Intake air'],
  ['throttle', 'Throttle'],
  ['ignition', 'Ignition'],
  ['obdSpeed', 'OBD speed'],
  ['gnssSpeed', 'GNSS speed'],
  ['controlVoltage', 'Control voltage'],
]

export const DEFAULT_STATUS_CARD_FIELDS = STATUS_CARD_FIELDS.map(([key]) => key)
