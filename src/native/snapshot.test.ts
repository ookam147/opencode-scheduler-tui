import { expect, test } from "bun:test"
import type { AutomationRow } from "./model.js"
import { retainUnchangedRows } from "./snapshot.js"

const row: AutomationRow = { id: "aut_a", name: "check", action: { type: "prompt", prompt: "check", to: { session: "ses_a" } }, trigger: { type: "every", every: "1 hour" }, tz: "UTC", directory: "/work", status: "active", runCount: 0 }

test("identical polls retain the array and row identities, including empty lists", () => {
  const previous = [row]
  expect(retainUnchangedRows(previous, structuredClone(previous))).toBe(previous)
  const empty: AutomationRow[] = []
  expect(retainUnchangedRows(empty, [])).toBe(empty)
})

test("changed, reordered and deleted rows are reflected without remounting unaffected rows", () => {
  const other = { ...row, id: "aut_b" }
  const previous = [row, other]
  const changed = retainUnchangedRows(previous, [{ ...row, runCount: 1 }, { ...other }])
  expect(changed[0]?.runCount).toBe(1)
  expect(changed[1]).toBe(other)
  expect(retainUnchangedRows(previous, [{ ...other }, { ...row }])).toEqual([other, row])
  expect(retainUnchangedRows(previous, [{ ...other }])[0]).toBe(other)
})

test("a renamed session updates the joined details even if the automation is unchanged", () => {
  const previous = [{ ...row, session: { id: "ses_a", title: "Old" } }]
  const next = structuredClone(previous)
  next[0]!.session.title = "New"
  const result = retainUnchangedRows(previous, next)
  expect(result).not.toBe(previous)
  expect(result[0]?.session?.title).toBe("New")
})
