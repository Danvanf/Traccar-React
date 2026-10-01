// A selection change invalidates every pending read/write UI completion for the old selection.
export function createRequestGate() {
  let generation = 0
  return {
    begin() { generation += 1; return generation },
    current() { return generation },
    isCurrent(token) { return token === generation },
  }
}
