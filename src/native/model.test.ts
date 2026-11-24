import { describe, expect, test } from "bun:test"
import { actionBody, belongsTo, codeWake, countAutomations, describeTrigger, selectAutomations, sortAutomations, targetSessionID, type AutomationRow } from "./model.js"

const rows: AutomationRow[] = [
  { id: "aut_a", sessionID: "ses_a", name: "喝水", action: { type: "prompt", prompt: "提醒喝水", to: { session: "ses_a" } }, trigger: { type: "at", at: "in 5 minutes" }, tz: "Asia/Shanghai", directory: "/work/reminders", status: "done", runCount: 1, session: { id: "ses_a", title: "健康提醒" } },
  { id: "aut_b", sessionID: "ses_b", name: "Review", action: { type: "shell", command: "gh pr status" }, trigger: { type: "cron", cron: "0 9 * * 1-5" }, tz: "UTC", directory: "/work/app", status: "active", runCount: 0, lastOutput: "Exit code: 1\nno PRs" },
  { id: "aut_c", sessionID: "ses_a", name: "Check", action: { type: "code", code: "return tools.slack.unread()" }, trigger: { type: "every", every: "1 hour" }, tz: "UTC", directory: "/work", status: "paused", runCount: 2 },
  { id: "aut_d", sessionID: "ses_c", name: "Ping", action: { type: "prompt", prompt: "ping", to: { session: "ses_a" } }, trigger: { type: "event", server: "github", event: "push" }, tz: "UTC", directory: "/work", status: "active", runCount: 0 },
  { id: "aut_e", sessionID: "ses_b", name: "Triage", action: { type: "prompt", prompt: "triage", to: { subagent: "explore" } }, trigger: { type: "every", every: "1 day" }, tz: "UTC", directory: "/work", status: "active", runCount: 0 },
]

describe("automation presentation", () => {
  test("counts status independently of active and paused", () => {
    expect(countAutomations(rows)).toEqual({ all: 5, active: 3, paused: 1, done: 1 })
    expect(countAutomations([])).toEqual({ all: 0, active: 0, paused: 0, done: 0 })
  })
  test("a session owns what it created and what prompts it", () => {
    expect(targetSessionID(rows[3]!)).toBe("ses_a")
    expect(targetSessionID(rows[4]!)).toBe("ses_b")
    expect(targetSessionID(rows[1]!)).toBe("ses_b")
    expect(belongsTo(rows[3]!, "ses_a")).toBe(true)
    expect(belongsTo(rows[3]!, "ses_c")).toBe(true)
    expect(belongsTo(rows[3]!, undefined)).toBe(false)
    expect(selectAutomations(rows, { sessionID: "ses_a" }).map((r) => r.id)).toEqual(["aut_a", "aut_c", "aut_d"])
  })
  test("combines session, status and search without mutating source", () => {
    expect(selectAutomations(rows, { sessionID: "ses_a", status: "done", query: "健康" }).map((r) => r.id)).toEqual(["aut_a"])
    expect(selectAutomations(rows, { query: "REVIEW" }).map((r) => r.id)).toEqual(["aut_b"])
    expect(selectAutomations(rows, { query: "/work/reminders" })).toHaveLength(1)
    expect(selectAutomations(rows, { sessionID: "missing" })).toEqual([])
    expect(rows).toHaveLength(5)
  })
  test("search finds actions by body, kind, subagent, trigger and last output", () => {
    for (const [query, id] of [["gh pr", "aut_b"], ["slack.unread", "aut_c"], ["explore", "aut_e"],
      ["github/push", "aut_d"], ["no PRs", "aut_b"], ["shell", "aut_b"]] as const) {
      expect(selectAutomations(rows, { query }).map((item) => item.id)).toEqual([id])
    }
  })
  test("sorts by next run (due timers, then event watches, paused, done) or by name, keeping creation order on ties", () => {
    const timed = (id: string, nextDueAt: number): AutomationRow => ({ ...rows[1]!, id, name: id, nextDueAt })
    const list = [rows[0]!, timed("late", 900), rows[2]!, rows[3]!, timed("soon", 100), timed("soon2", 100)]
    expect(sortAutomations(list, "next").map((r) => r.id)).toEqual(["soon", "soon2", "late", "aut_d", "aut_c", "aut_a"])
    expect(sortAutomations(list, "created")).toBe(list)
    const named = ["task 10", "Task 2", "apple"].map((name, i) => ({ ...rows[1]!, id: String(i), name }))
    expect(sortAutomations(named, "name", "en").map((r) => r.name)).toEqual(["apple", "Task 2", "task 10"])
    expect(list.map((r) => r.id)).toEqual(["aut_a", "late", "aut_c", "aut_d", "soon", "soon2"])
  })
  test("tells whether a code run woke an agent from its handoff line", () => {
    const code = { action: { type: "code" as const, code: "x" } }
    expect(codeWake({ ...code, lastOutcome: "fired", lastOutput: "Prompted ses_abc\nlog" })).toBe("woke")
    expect(codeWake({ ...code, lastOutcome: "late", lastOutput: "Started subagent ses_aut_1_2" })).toBe("woke")
    expect(codeWake({ ...code, lastOutcome: "fired", lastOutput: "checked 3 orders" })).toBe("quiet")
    expect(codeWake({ ...code, lastOutcome: "fired" })).toBe("quiet")
    // A log line that merely mentions a session later on is not a handoff.
    expect(codeWake({ ...code, lastOutcome: "fired", lastOutput: "ok\nPrompted ses_abc" })).toBe("quiet")
    expect(codeWake({ ...code, lastOutcome: "failed", lastOutput: "Prompted ses_abc" })).toBeUndefined()
    expect(codeWake({ ...code })).toBeUndefined()
    expect(codeWake({ action: { type: "shell", command: "ls" }, lastOutcome: "fired" })).toBeUndefined()
  })
  test("describes all four trigger kinds and reads each action body", () => {
    expect(describeTrigger(rows[0]!.trigger)).toBe("单次 in 5 minutes")
    expect(describeTrigger(rows[1]!.trigger)).toBe("Cron 0 9 * * 1-5")
    expect(describeTrigger(rows[2]!.trigger)).toBe("每隔 1 hour")
    expect(describeTrigger(rows[3]!.trigger)).toBe("MCP github/push")
    expect(rows.map((row) => actionBody(row.action))).toEqual(["提醒喝水", "gh pr status", "return tools.slack.unread()", "ping", "triage"])
  })
})
