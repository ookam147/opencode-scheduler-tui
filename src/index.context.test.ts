import { describe, expect, test } from "bun:test"
import { resolve } from "path"
import { resolveToolDirectory, runJobUpdateTransaction, type JobUpdateTransaction } from "./index"

describe("scheduler tool project context", () => {
  test("uses the OpenCode tool directory instead of the process cwd", () => {
    expect(resolveToolDirectory(undefined, "/projects/current")).toBe(resolve("/projects/current"))
  })

  test("keeps an explicit workdir as the highest priority", () => {
    expect(resolveToolDirectory("/projects/explicit", "/projects/current")).toBe(resolve("/projects/explicit"))
  })
})

describe("scheduler job update transaction", () => {
  function transaction(overrides: Partial<JobUpdateTransaction> = {}) {
    const calls: string[] = []
    const record = (name: string) => () => { calls.push(name) }
    const value: JobUpdateTransaction = {
      scopeChanged: true,
      updatedEnabled: true,
      originalEnabled: true,
      uninstallOriginal: record("uninstall-original"),
      saveUpdated: record("save-updated"),
      installUpdated: record("install-updated"),
      verifyUpdated: record("verify-updated"),
      moveData: record("move-data"),
      deleteOriginal: record("delete-original"),
      cleanupUpdated: record("cleanup-updated"),
      rollbackData: () => { calls.push("rollback-data") },
      removeUpdated: record("remove-updated"),
      restoreOriginal: record("restore-original"),
      installOriginal: record("install-original"),
      verifyOriginal: record("verify-original"),
      audit: () => { calls.push("audit") },
      ...overrides,
    }
    return { calls, value }
  }

  test("moves a paused task without installing either scheduler entry", () => {
    const item = transaction({ updatedEnabled: false, originalEnabled: false })
    runJobUpdateTransaction(item.value)
    expect(item.calls).toEqual(["uninstall-original", "save-updated", "move-data", "delete-original"])
  })

  test("moves an active task only after the target scheduler entry verifies", () => {
    const item = transaction()
    runJobUpdateTransaction(item.value)
    expect(item.calls).toEqual([
      "uninstall-original",
      "save-updated",
      "install-updated",
      "verify-updated",
      "move-data",
      "delete-original",
    ])
  })

  test("restores the original task after a partial target installation failure", () => {
    const item = transaction()
    item.value.installUpdated = () => { item.calls.push("install-updated"); throw new Error("install failed") }
    expect(() => runJobUpdateTransaction(item.value)).toThrow("Failed to update job: install failed")
    expect(item.calls).toEqual([
      "uninstall-original",
      "save-updated",
      "install-updated",
      "cleanup-updated",
      "rollback-data",
      "remove-updated",
      "restore-original",
      "install-original",
      "verify-original",
      "audit",
    ])
  })
})
