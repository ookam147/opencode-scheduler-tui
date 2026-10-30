import { describe, expect, test } from "bun:test"
import { countSchedules, describeWhen, selectSchedules, type ScheduleRow } from "./model.js"

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
  test("search includes the joined session agent, model, provider and reasoning variant", () => {
    const joined: ScheduleRow[] = [{ ...rows[0]!, session: {
      id: "ses_a", agent: "build", model: { id: "glm-5.3", providerID: "zai-coding-plan", variant: "max" },
    } }]
    for (const query of ["BUILD", "glm-5.3", "zai-coding-plan", "max"]) {
      expect(selectSchedules(joined, { query })).toHaveLength(1)
    }
  })
})
