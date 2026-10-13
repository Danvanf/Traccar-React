export const WINDOW_COVERAGE_LIMIT = 0.9
export const WINDOW_CLEARANCE_PX = 10

export function intersectionArea(first, second) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
  return width * height
}

export function coveredRatio(underneath, overlay) {
  const area = Math.max(0, underneath.width) * Math.max(0, underneath.height)
  return area > 0 ? intersectionArea(underneath, overlay) / area : 0
}

function rectAt(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

function expandRect(rect, amount) {
  return rectAt(rect.left - amount, rect.top - amount, rect.width + amount * 2, rect.height + amount * 2)
}

function insideViewport(rect, width, height, margin) {
  return rect.left >= margin && rect.top >= margin && rect.right <= width - margin && rect.bottom <= height - margin
}

export function findNearestAvailablePosition(target, {
  viewportWidth,
  viewportHeight,
  gapRects = [],
  hardBlockers = [],
  softBlockers = [],
  margin = 8,
  gap = WINDOW_CLEARANCE_PX,
  gridStep = 32,
} = {}) {
  const expandedGaps = gapRects.map((rect) => expandRect(rect, gap))
  const candidates = new Map()
  const add = (left, top) => {
    const maxLeft = Math.max(margin, viewportWidth - target.width - margin)
    const maxTop = Math.max(margin, viewportHeight - target.height - margin)
    const x = Math.round(Math.max(margin, Math.min(left, maxLeft)))
    const y = Math.round(Math.max(margin, Math.min(top, maxTop)))
    candidates.set(`${x}:${y}`, rectAt(x, y, target.width, target.height))
  }

  add(target.left, target.top)
  const allBlockers = [...gapRects, ...hardBlockers, ...softBlockers]
  allBlockers.forEach((blocker) => {
    add(blocker.left - target.width - gap, target.top)
    add(blocker.right + gap, target.top)
    add(target.left, blocker.top - target.height - gap)
    add(target.left, blocker.bottom + gap)
    add(blocker.left - target.width - gap, blocker.top - target.height - gap)
    add(blocker.right + gap, blocker.top - target.height - gap)
    add(blocker.left - target.width - gap, blocker.bottom + gap)
    add(blocker.right + gap, blocker.bottom + gap)
  })

  for (let top = margin; top <= viewportHeight - target.height - margin; top += gridStep) {
    for (let left = margin; left <= viewportWidth - target.width - margin; left += gridStep) add(left, top)
  }

  const valid = [...candidates.values()].filter((candidate) => {
    if (!insideViewport(candidate, viewportWidth, viewportHeight, margin)) return false
    if (expandedGaps.some((blocker) => intersectionArea(candidate, blocker) > 0)) return false
    if (hardBlockers.some((blocker) => intersectionArea(candidate, blocker) > 0)) return false
    return softBlockers.every((blocker) => coveredRatio(blocker, candidate) < WINDOW_COVERAGE_LIMIT)
  })

  valid.sort((first, second) => {
    const firstDistance = ((first.left - target.left) ** 2) + ((first.top - target.top) ** 2)
    const secondDistance = ((second.left - target.left) ** 2) + ((second.top - target.top) ** 2)
    return firstDistance - secondDistance
  })
  return valid[0] ? { left: valid[0].left, top: valid[0].top } : null
}
