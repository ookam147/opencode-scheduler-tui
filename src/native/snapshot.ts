import type { AutomationRow } from "./model.js"

/** SDK polls allocate new objects; preserve unchanged rows so Solid doesn't remount them. */
export function retainUnchangedRows(previous: AutomationRow[], next: AutomationRow[]): AutomationRow[] {
  const byID = new Map(previous.map((row) => [row.id, row]))
  const result = next.map((row) => {
    const old = byID.get(row.id)
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row
  })
  return result.length === previous.length && result.every((row, index) => row === previous[index])
    ? previous : result
}
