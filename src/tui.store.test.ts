import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createStatusStore } from "./tui"
import type { SchedulerStatusSnapshot } from "./status"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function snapshot(): SchedulerStatusSnapshot {
  return {
    scannedAt: new Date().toISOString(),
    timezone: "UTC",
    jobs: [],
    orphans: [],
    diagnostics: [],
    summary: { total: 0, healthy: 0, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for scheduler refresh")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("scheduler TUI status store", () => {
  test("refreshes after an atomic scheduler file rename", async () => {
    const root = mkdtempSync(join(tmpdir(), "scheduler-tui-watch-"))
    roots.push(root)
    const jobs = join(root, "scopes", "scope", "jobs")
    mkdirSync(jobs, { recursive: true })
    const cleanup: Array<() => void> = []
    let loads = 0
    const api = {
      lifecycle: { onDispose(fn: () => void) { cleanup.push(fn); return fn } },
      ui: { toast() {} },
    }
    createStatusStore(api as never, {
      schedulerRoot: root,
      debounceMs: 25,
      fallbackMs: 10_000,
      verificationMs: 10_000,
      loadStatus: () => { loads += 1; return snapshot() },
    })
    await waitFor(() => loads >= 1)
    const temporary = join(jobs, "task.json.tmp")
    writeFileSync(temporary, "{}")
    renameSync(temporary, join(jobs, "task.json"))
    await waitFor(() => loads >= 2)
    expect(loads).toBeGreaterThanOrEqual(2)
    cleanup.forEach((fn) => fn())
  })
})
