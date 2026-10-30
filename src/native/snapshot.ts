import type { ScheduleRow } from "./model.js"

/** SDK polls allocate new objects; preserve unchanged rows so Solid doesn't remount them. */
export function retainUnchangedRows(previous: ScheduleRow[], next: ScheduleRow[]): ScheduleRow[] {
  const byID = new Map(previous.map((row) => [row.id, row]))
  const result = next.map((row) => {
    const old = byID.get(row.id)
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row
  })
  return result.length === previous.length && result.every((row, index) => row === previous[index])
    ? previous : result
}

export function retainUnchangedWarnings(previous: string[], next: string[]): string[] {
  return previous.length === next.length && previous.every((value, index) => value === next[index])
    ? previous : next
}
