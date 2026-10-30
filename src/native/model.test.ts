import { describe, expect, test } from "bun:test"
import { countSchedules, describeCondition, describeWhen, scheduleCheck, selectSchedules, type ScheduleRow } from "./model.js"

const rows: ScheduleRow[] = [
  { id: "sch_a", sessionID: "ses_a", name: "喝水", prompt: "提醒喝水", when: { type: "in", in: "5 minutes" }, tz: "Asia/Shanghai", status: "done", runCount: 1, session: { id: "ses_a", title: "健康提醒", directory: "/work/reminders" } },
  { id: "sch_b", sessionID: "ses_b", name: "Review", prompt: "Review changes", when: { type: "cron", cron: "0 9 * * 1-5" }, tz: "UTC", status: "active", runCount: 0 },
  { id: "sch_c", sessionID: "ses_a", prompt: "Check", when: { type: "every", every: "1 hour" }, tz: "UTC", status: "paused", runCount: 2 },
]

describe("native schedule presentation", () => {
  test("counts native terminal status independently of active and paused", () => {
    expect(countSchedules(rows)).toEqual({ all: 3, active: 1, paused: 1, done: 1 })
    expect(countSchedules([])).toEqual({ all: 0, active: 0, paused: 0, done: 0 })
  })
  test("combines session, native status and search without mutating source", () => {
    expect(selectSchedules(rows, { sessionID: "ses_a", status: "done", query: "健康" }).map((r) => r.id)).toEqual(["sch_a"])
    expect(selectSchedules(rows, { query: "REVIEW" }).map((r) => r.id)).toEqual(["sch_b"])
    expect(selectSchedules(rows, { query: "/work/reminders" })).toHaveLength(1)
    expect(selectSchedules(rows, { sessionID: "missing" })).toEqual([])
    expect(rows).toHaveLength(3)
  })
  test("describes all four trigger kinds without computing a replacement next run", () => {
    expect(describeWhen({ type: "in", in: "5 minutes" })).toBe("延时 5 minutes")
    expect(describeWhen({ type: "at", at: "2026-11-01T09:00" })).toBe("指定时间 2026-11-01T09:00")
    expect(describeWhen(rows[1]!.when)).toBe("Cron 0 9 * * 1-5")
    expect(describeWhen(rows[2]!.when)).toBe("每隔 1 hour")
  })
  test("reads the single stored gate and prefers `if` over `until`", () => {
    const shell = { type: "shell" as const, run: "git fetch --dry-run", changes: true }
    const code = { type: "code" as const, code: "return true" }
    expect(scheduleCheck({ ...rows[1]!, if: shell })).toEqual({ mode: "if", condition: shell })
    expect(scheduleCheck({ ...rows[1]!, until: code })).toEqual({ mode: "until", condition: code })
    expect(scheduleCheck(rows[1]!)).toBeUndefined()
    // The service stores one check, so a row carrying both still resolves to a single gate.
    expect(scheduleCheck({ ...rows[1]!, if: shell, until: code })).toEqual({ mode: "if", condition: shell })
  })
  test("describes a gate like the service does, summarizing code by its first real line", () => {
    expect(describeCondition({ type: "shell", run: "test -f ready.txt" })).toBe("test -f ready.txt")
    expect(describeCondition({ type: "code", code: "\n\n  return tools.a.b()  \n" })).toBe("code (return tools.a.b())")
    expect(describeCondition({ type: "code", code: "   \n " })).toBe("code")
    const long = describeCondition({ type: "code", code: `return "${"x".repeat(80)}"` })
    expect(long.slice(6, -1)).toHaveLength(60)
    expect(long.startsWith('code (return "xxx')).toBe(true)
  })
  test("search finds gated tasks by mode, command, predicate and code", () => {
    const gated: ScheduleRow[] = [
      { ...rows[1]!, id: "sch_shell", if: { type: "shell", run: "gh pr status", matches: "^OPEN$" } },
      { ...rows[2]!, id: "sch_code", until: { type: "code", code: "return tools.slack.unread() > 0" } },
    ]
    for (const [query, id] of [["if", "sch_shell"], ["gh pr", "sch_shell"], ["^OPEN$", "sch_shell"],
      ["until", "sch_code"], ["slack.unread", "sch_code"]] as const) {
      expect(selectSchedules(gated, { query }).map((item) => item.id)).toEqual([id])
    }
    expect(selectSchedules([{ ...rows[1]!, if: { type: "shell", run: "ls", changes: true } }], { query: "changes" }))
      .toHaveLength(1)
  })
  test("search includes the joined session agent, model, provider and reasoning variant", () => {
    const joined: ScheduleRow[] = [{ ...rows[0]!, session: {
      id: "ses_a", agent: "build", model: { id: "glm-5.3", providerID: "zai-coding-plan", variant: "max" },
    } }]
    for (const query of ["BUILD", "glm-5.3", "zai-coding-plan", "max"]) {
      expect(selectSchedules(joined, { query })).toHaveLength(1)
    }
  })
})
