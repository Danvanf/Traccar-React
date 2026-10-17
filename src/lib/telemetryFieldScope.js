export function telemetryFieldScopeKey(profileId, vehicleId, deviceId, fieldKey) {
  return `${profileId || 'unassigned'}::${vehicleId || 'unbound'}::device:${deviceId ?? 'unknown'}::${fieldKey}`
}

export function legacyTelemetryFieldScopeKey(profileId, vehicleId, fieldKey) {
  return `${profileId || 'unassigned'}::${vehicleId || 'unbound'}::${fieldKey}`
}

export function isSuggestionDismissed(tokens, scopeKey, profileId, legacyScopeKey = '') {
  return tokens.includes(`${scopeKey}::*`)
    || tokens.includes(`${scopeKey}::${profileId}`)
    || (legacyScopeKey && (tokens.includes(`${legacyScopeKey}::*`) || tokens.includes(`${legacyScopeKey}::${profileId}`)))
}

export function hasDismissedSuggestions(tokens, scopeKey, legacyScopeKey = '') {
  return tokens.some((token) => token.startsWith(`${scopeKey}::`)
    || (legacyScopeKey && token.startsWith(`${legacyScopeKey}::`)))
}
