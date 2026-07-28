import { describe, expect, test } from "bun:test"
import { filterSchedulerJobs, tui } from "./tui"
import type { SchedulerJobStatus } from "./status"

describe("scheduler TUI plugin", () => {
  test("filters status projections by query, state, and project", () => {
    const make = (name: string, health: SchedulerJobStatus["health"], scopeId: string, enabled = true) => ({
      name,
      slug: name.toLowerCase(),
      health,
      enabled,
      scopeId,
      workdir: `/projects/${scopeId}`,
      scheduleText: "daily",
      model: name === "Daily report" ? "openai/gpt-5" : undefined,
    }) as SchedulerJobStatus
    const jobs = [make("Daily report", "healthy", "one"), make("Failed sync", "drifted", "one"), make("Paused backup", "paused", "two", false)]
    expect(filterSchedulerJobs(jobs, { query: "sync", filter: "problems" }).map((job) => job.name)).toEqual(["Failed sync"])
    expect(filterSchedulerJobs(jobs, { filter: "paused", scopeId: "two" }).map((job) => job.name)).toEqual(["Paused backup"])
    expect(filterSchedulerJobs(jobs, { filter: "active" })).toHaveLength(2)
    expect(filterSchedulerJobs(jobs, { query: "gpt-5" }).map((job) => job.name)).toEqual(["Daily report"])
    expect(filterSchedulerJobs(jobs, { scopeId: "one" })).toHaveLength(2)
  })

  test("registers sidebar, routes, slash command, and cleanup", async () => {
    const slots: unknown[] = []
    const routes: unknown[] = []
    const commands: unknown[] = []
    const cleanup: Array<() => void> = []
    const api = {
      lifecycle: { onDispose: (fn: () => void) => cleanup.push(fn) },
      slots: { register: (value: unknown) => slots.push(value) },
      route: { register: (value: unknown) => routes.push(value), navigate() {} },
      command: { register: (value: unknown) => commands.push(value) },
      ui: { toast() {}, dialog: { clear() {} } },
    }

    await tui(api as never, undefined, {} as never)

    expect(slots).toHaveLength(1)
    expect((slots[0] as { order: number }).order).toBe(199)
    expect(routes).toHaveLength(1)
    expect((routes[0] as Array<{ name: string }>).map((item) => item.name)).toEqual(["scheduler", "scheduler-detail"])
    expect(commands).toHaveLength(1)
    expect(cleanup).toHaveLength(1)
    cleanup.forEach((fn) => fn())
  })
})
