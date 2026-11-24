import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import { createAutomationClient, type AutomationClientSource } from "./client"

type Info = Awaited<ReturnType<OpenCodeClient["experimental"]["automation"]["pause"]>>
const automation = (id = "aut_1", sessionID: string | null = "ses_1", action: Info["action"] = { type: "prompt", prompt: "hello", to: { session: sessionID ?? "ses_x" } }): Info => ({
  id, name: `Task ${id}`, projectID: "prj_1", ...(sessionID ? { sessionID } : {}), directory: "/workspace", action,
  trigger: { type: "every", every: "1 hour" }, status: "active", tz: "UTC", runCount: 0,
  nextDueAt: 123, expires: 0, lastRunAt: 100, state: { secret: true }, time: { created: 1, updated: 2 },
})

function fake(rows: Info[] = [automation()]) {
  const calls: unknown[] = []
  const source: AutomationClientSource = {
    experimental: { automation: {
      list: async (input) => { calls.push(["list", input]); return rows },
      pause: async ({ automationID }) => { calls.push(`pause:${automationID}`); return { ...automation(automationID), status: "paused" } },
      resume: async ({ automationID }) => { calls.push(`resume:${automationID}`); return automation(automationID) },
      delete: async ({ automationID }) => { calls.push(`delete:${automationID}`) },
    } },
  }
  const titles: Record<string, string> = { ses_1: "Title ses_1", ses_2: "Title ses_2" }
  const looked: string[] = []
  const adapter = createAutomationClient(source, (id) => { looked.push(id); return titles[id] ? { id, title: titles[id] } : undefined })
  return { source, calls, looked, adapter }
}

describe("automation adapter", () => {
  test("lists every automation in one unfiltered request and preserves millisecond timestamps", async () => {
    const { adapter, calls } = fake()
    const rows = await adapter.list()
    expect(calls).toEqual([["list", undefined]])
    expect(rows[0]).toMatchObject({ id: "aut_1", nextDueAt: 123, expires: 0, lastRunAt: 100,
      time: { created: 1, updated: 2 }, session: { id: "ses_1", title: "Title ses_1" } })
    // A code action's saved state is shown in the details.
    expect(rows[0]!.state).toEqual({ secret: true })
  })

  test("joins titles from the host cache only, including a different prompt target", async () => {
    const { adapter, looked } = fake([
      automation("aut_a", "ses_1", { type: "prompt", prompt: "x", to: { session: "ses_2" } }),
      automation("aut_b", "ses_gone"),
      automation("aut_c", null, { type: "shell", command: "ls" }),
    ])
    const [a, b, c] = await adapter.list()
    expect(a?.target).toEqual({ id: "ses_2", title: "Title ses_2" })
    // An uncached or deleted session keeps its id and shows no invented title.
    expect(b?.session).toEqual({ id: "ses_gone" })
    expect(b).not.toHaveProperty("target")
    expect(c?.session).toBeUndefined()
    expect(looked.sort()).toEqual(["ses_1", "ses_2", "ses_gone"])
  })

  test("a list failure rejects instead of reporting a partial result", async () => {
    const { source, adapter } = fake()
    source.experimental.automation.list = async () => { throw new Error("Automations are disabled") }
    await expect(adapter.list()).rejects.toThrow("Automations are disabled")
  })

  test("pause, resume use unwrapped data; delete accepts a 204/void result", async () => {
    const { adapter, calls } = fake()
    expect((await adapter.pause("aut_1")).status).toBe("paused")
    expect((await adapter.resume("aut_1")).status).toBe("active")
    expect(await adapter.remove("aut_1")).toBeUndefined()
    expect(calls).toEqual(["pause:aut_1", "resume:aut_1", "delete:aut_1"])
  })

  test("pre-aborted signals do no work", async () => {
    const { adapter, calls } = fake()
    const controller = new AbortController()
    controller.abort()
    await expect(adapter.list({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toEqual([])
  })

  test("propagates the signal and rejects on abort even if the transport ignores it", async () => {
    const { source, adapter } = fake()
    const controller = new AbortController()
    source.experimental.automation.list = async (_, options) => {
      expect(options?.signal).toBe(controller.signal)
      controller.abort()
      return new Promise<Info[]>(() => {})
    }
    await expect(adapter.list({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
  })
})
