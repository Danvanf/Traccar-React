import assert from 'node:assert/strict'
import test from 'node:test'
import { hasDismissedSuggestions, isSuggestionDismissed, legacyTelemetryFieldScopeKey, telemetryFieldScopeKey } from '../src/lib/telemetryFieldScope.js'

test('personal field scope separates trackers while retaining vehicle and profile context', () => {
  const first = telemetryFieldScopeKey('teltonika', 'truck-a', 101, 'io13201')
  const second = telemetryFieldScopeKey('teltonika', 'truck-a', 202, 'io13201')
  assert.notEqual(first, second)
  assert.match(first, /device:101::io13201$/)
})

test('legacy dismissal choices remain honored after source-specific scoping', () => {
  const legacy = legacyTelemetryFieldScopeKey('teltonika', 'truck-a', 'io13201')
  const current = telemetryFieldScopeKey('teltonika', 'truck-a', 101, 'io13201')
  assert.equal(isSuggestionDismissed([`${legacy}::catalog:teltonika:model:io13201`], current, 'catalog:teltonika:model:io13201', legacy), true)
  assert.equal(isSuggestionDismissed([], current, 'catalog:teltonika:model:io13201', legacy), false)
})

test('dismissed suggestions remain discoverable for undo across editor sessions', () => {
  const scope = telemetryFieldScopeKey('teltonika', 'truck-a', 101, 'io13201')
  const legacy = legacyTelemetryFieldScopeKey('teltonika', 'truck-a', 'io13201')
  assert.equal(hasDismissedSuggestions([`${scope}::catalog:a`], scope, legacy), true)
  assert.equal(hasDismissedSuggestions([`${legacy}::*`], scope, legacy), true)
  assert.equal(hasDismissedSuggestions([], scope, legacy), false)
})
