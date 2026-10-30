import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import { createNativeScheduleClient, type NativeScheduleClientSource } from "./client"

type Schedule = Awaited<ReturnType<OpenCodeClient["experimental"]["schedule"]["pause"]>>
type Session = Awaited<ReturnType<OpenCodeClient["session"]["get"]>>
const schedule = (id = "sch_1", sessionID = "ses_1"): Schedule => ({
  id, sessionID, action: { type: "prompt", prompt: "hello" }, when: { type: "every", every: "1h" },
  status: "active", tz: "UTC", runCount: 0, nextDueAt: 123, endsAt: 0,
  lastFiredAt: 100, time: { created: 1, updated: 2 },
})
const session = (id = "ses_1"): Session => ({
  id, projectID: "prj_1", title: `Title ${id}`, location: { directory: `/workspace/${id}` },
  cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
})

function fake() {
  const calls: string[] = []
  const source: NativeScheduleClientSource = {
    session: {
      list: async () => { calls.push("sessions"); return { data: [session()], cursor: {} } },
      get: async ({ sessionID }) => { calls.push(`get:${sessionID}`); return session(sessionID) },
    },
    experimental: { schedule: {
      list: async ({ sessionID }) => { calls.push(`list:${sessionID}`); return [schedule("sch_1", sessionID)] },
      pause: async ({ scheduleID }) => { calls.push(`pause:${scheduleID}`); return { ...schedule(scheduleID), status: "paused" } },
      resume: async ({ scheduleID }) => { calls.push(`resume:${scheduleID}`); return schedule(scheduleID) },
      delete: async ({ scheduleID }) => { calls.push(`delete:${scheduleID}`) },
    } },
  }
  return { source, calls, adapter: createNativeScheduleClient(source) }
}

describe("native schedule adapter", () => {
  test.each(["current", "all"] as const)("joins current agent and model settings via session API (%s)", async (scope) => {
    const { source, adapter } = fake()
    const info = { ...session(), agent: "build", model: { id: "gpt-6.1", providerID: "openai", variant: "high" } }
    source.session.get = async () => info
    source.session.list = async () => ({ data: [info], cursor: {} })
    const result = await adapter.list({ scope, sessionID: info.id })
    expect(result.rows[0]?.session).toMatchObject({ agent: "build", model: info.model })
  })
  test("current reads only its session and preserves millisecond timestamps", async () => {
    const { adapter, calls } = fake()
    const result = await adapter.list({ scope: "current", sessionID: "ses_1" })
    expect(calls).toEqual(["get:ses_1", "list:ses_1"])
    expect(result.warnings).toEqual([])
    expect(result.rows[0]).toMatchObject({ prompt: "hello", nextDueAt: 123, endsAt: 0, lastFiredAt: 100,
      time: { created: 1, updated: 2 }, session: { title: "Title ses_1", directory: "/workspace/ses_1" } })
    expect(result.rows[0]).not.toHaveProperty("action")
  })

  test("current without a session makes no request", async () => {
    const { adapter, calls } = fake()
    expect(await adapter.list({ scope: "current" })).toEqual({ rows: [], warnings: [] })
    expect(calls).toEqual([])
  })

  test("does not guess a missing model and localizes adapter-generated warnings", async () => {
    const { source } = fake()
    const adapter = createNativeScheduleClient(source, "en")
    const first = await adapter.list({ scope: "current", sessionID: "ses_1" })
    expect(first.rows[0]?.session?.model).toBeUndefined()
    source.session.get = async () => { throw new Error("403 Forbidden") }
    const result = await adapter.list({ scope: "current", sessionID: "ses_1" })
    expect(result.warnings[0]).toContain("Could not read session metadata")
    expect(result.warnings[0]).toContain("403 Forbidden")
  })

  test("walks session pages, deduplicates sessions and rows, caps concurrency at four", async () => {
    const { source, adapter } = fake()
    const cursors: (string | undefined)[] = []
    source.session.list = async (input) => {
      cursors.push(input?.cursor)
      return input?.cursor ? { data: [session("ses_1"), ...Array.from({ length: 6 }, (_, i) => session(`ses_${i + 2}`))], cursor: {} }
        : { data: [session()], cursor: { next: "page2" } }
    }
    let active = 0
    let peak = 0
    const listed: string[] = []
    source.experimental.schedule.list = async ({ sessionID }) => {
      listed.push(sessionID)
      peak = Math.max(peak, ++active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return [schedule(`sch_${sessionID}`, sessionID), schedule(`sch_${sessionID}`, sessionID)]
    }
    const result = await adapter.list({ scope: "all" })
    expect(cursors).toEqual([undefined, "page2"])
    expect(listed.length).toBe(7)
    expect(result.rows.length).toBe(7)
    expect(peak).toBe(4)
    expect(result.warnings).toEqual([])
  })

  test("a failed/unauthorized session becomes a warning, not loss of other rows", async () => {
    const { source, adapter } = fake()
    source.session.list = async () => ({ data: [session("ses_bad"), session("ses_ok")], cursor: { next: null } })
    source.experimental.schedule.list = async ({ sessionID }) => {
      if (sessionID === "ses_bad") throw new Error("403 Forbidden")
      return [schedule("sch_ok", sessionID)]
    }
    const result = await adapter.list({ scope: "all" })
    expect(result.rows.map((row) => row.id)).toEqual(["sch_ok"])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("ses_bad")
    expect(result.warnings[0]).toContain("403 Forbidden")
  })

  test("session enumeration failures and repeating cursors reject", async () => {
    const { source, adapter } = fake()
    source.session.list = async () => { throw new Error("cannot list sessions") }
    await expect(adapter.list({ scope: "all" })).rejects.toThrow("cannot list sessions")
    source.session.list = async () => ({ data: [], cursor: { next: "loop" } })
    await expect(adapter.list({ scope: "all" })).rejects.toThrow("游标重复")
  })

  test("current metadata failures preserve schedules with a warning", async () => {
    const { source, adapter } = fake()
    source.session.get = async () => { throw new Error("no access") }
    const result = await adapter.list({ scope: "current", sessionID: "ses_1" })
    expect(result.rows).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
  })

  test("pause, resume use unwrapped data; delete accepts a 204/void result", async () => {
    const { adapter, calls } = fake()
    expect((await adapter.pause("sch_1")).status).toBe("paused")
    expect((await adapter.resume("sch_1")).status).toBe("active")
    expect(await adapter.remove("sch_1")).toBeUndefined()
    expect(calls).toEqual(["pause:sch_1", "resume:sch_1", "delete:sch_1"])
  })

  test("pre-aborted signals do no work", async () => {
    const { adapter, calls } = fake()
    const controller = new AbortController()
    controller.abort()
    await expect(adapter.list({ scope: "all", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toEqual([])
  })

  test("abort during listing rejects, propagates signal, and does not schedule more workers", async () => {
    const { source, adapter } = fake()
    const controller = new AbortController()
    source.session.list = async (_, options) => {
      expect(options?.signal).toBe(controller.signal)
      return { data: Array.from({ length: 10 }, (_, i) => session(`ses_${i}`)), cursor: {} }
    }
    let started = 0
    source.experimental.schedule.list = async (_, options) => {
      expect(options?.signal).toBe(controller.signal)
      started++
      if (started === 4) controller.abort()
      return new Promise<Schedule[]>(() => {})
    }
    await expect(adapter.list({ scope: "all", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(started).toBe(4)
  })

  test("abort during session pagination rejects even if transport ignores it", async () => {
    const { source, adapter } = fake()
    const controller = new AbortController()
    source.session.list = async () => {
      controller.abort()
      return new Promise(() => {})
    }
    await expect(adapter.list({ scope: "all", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
})
