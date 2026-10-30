import { expect, test } from "bun:test"
import type { ScheduleRow } from "./model.js"
import { retainUnchangedRows, retainUnchangedWarnings } from "./snapshot.js"

const row: ScheduleRow = { id: "sch_a", prompt: "check", when: { type: "every", every: "1 hour" }, tz: "UTC", status: "active", runCount: 0 }

test("identical polls retain the array and row identities, including empty lists", () => {
  const previous = [row]
  expect(retainUnchangedRows(previous, structuredClone(previous))).toBe(previous)
  const empty: ScheduleRow[] = []
  expect(retainUnchangedRows(empty, [])).toBe(empty)
  const warnings = ["unavailable"]
  expect(retainUnchangedWarnings(warnings, [...warnings])).toBe(warnings)
})

test("changed, reordered and deleted rows are reflected without remounting unaffected rows", () => {
  const other = { ...row, id: "sch_b" }
  const previous = [row, other]
  const changed = retainUnchangedRows(previous, [{ ...row, runCount: 1 }, { ...other }])
  expect(changed[0]?.runCount).toBe(1)
  expect(changed[1]).toBe(other)
  expect(retainUnchangedRows(previous, [{ ...other }, { ...row }])).toEqual([other, row])
  expect(retainUnchangedRows(previous, [{ ...other }])[0]).toBe(other)
  expect(retainUnchangedWarnings(["old"], ["new"])).toEqual(["new"])
})

test("a changed session model variant updates the joined details even if the schedule is unchanged", () => {
  const previous = [{ ...row, session: { id: "ses_a", model: { id: "glm-5.3", providerID: "zai-coding-plan", variant: "high" } } }]
  const next = structuredClone(previous)
  next[0]!.session.model.variant = "max"
  const result = retainUnchangedRows(previous, next)
  expect(result).not.toBe(previous)
  expect(result[0]?.session?.model?.variant).toBe("max")
})
