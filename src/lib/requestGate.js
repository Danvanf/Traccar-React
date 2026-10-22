// A selection change invalidates every pending read/write UI completion for the old selection.
export function createRequestGate() {
  let generation = 0
  return {
    begin() { generation += 1; return generation },
    current() { return generation },
    isCurrent(token) { return token === generation },
  }
}

// Stale failures are ignored just like stale successes; current failures remain actionable.
export async function readCurrentRequest(gate, read) {
  const token = gate.current()
  try {
    const value = await read()
    return gate.isCurrent(token) ? { current: true, value } : { current: false }
  } catch (error) {
    if (!gate.isCurrent(token)) return { current: false }
    throw error
  }
}