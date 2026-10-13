import test from 'node:test'
import assert from 'node:assert/strict'
import { coveredRatio, findNearestAvailablePosition } from '../src/lib/windowCollisions.js'

test('coverage is measured against the panel underneath', () => {
  const largePanel = { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 }
  const smallOverlay = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
  assert.equal(coveredRatio(largePanel, smallOverlay), 1 / 6)
  assert.equal(coveredRatio(smallOverlay, largePanel), 1)
})

test('relocates an underneath panel to a nearby position with clearance', () => {
  const underneath = { left: 40, top: 40, right: 140, bottom: 140, width: 100, height: 100 }
  const overlay = { left: 40, top: 40, right: 240, bottom: 240, width: 200, height: 200 }
  const position = findNearestAvailablePosition(underneath, {
    viewportWidth: 800,
    viewportHeight: 600,
    gapRects: [overlay],
  })
  assert.ok(position)
  const moved = { ...position, right: position.left + 100, bottom: position.top + 100, width: 100, height: 100 }
  assert.ok(moved.left >= 8 && moved.top >= 8 && moved.right <= 792 && moved.bottom <= 592)
  assert.equal(coveredRatio(moved, overlay), 0)
})
