import { describe, expect, test } from "bun:test"
import { clockTime, columns, fit, nextLabel, relativeTime } from "./format"

describe("schedule formatting", () => {
  test("measures and fits CJK text by terminal columns", () => {
    expect(columns("喝水a")).toBe(5)
    expect(fit("喝水提醒", 6)).toBe("喝水… ")
    expect(columns(fit("每日站会摘要", 7))).toBe(7)
    expect(fit("3", 4, "right")).toBe("   3")
  })
  test("relative and clock times", () => {
    const now = new Date(2026, 9, 29, 12, 0).getTime()
    expect(relativeTime(now + 30_000, now)).toBe("即将")
    expect(relativeTime(now + 59.8 * 60_000, now)).toBe("1 小时后")
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3 分钟前")
    expect(clockTime(new Date(2026, 9, 30, 9, 5).getTime(), now)).toBe("明天 09:05")
    expect(clockTime(new Date(2027, 0, 2, 9, 0).getTime(), now)).toBe("2027-01-02 09:00")
  })
  test("next column explains paused and finished schedules", () => {
    expect(nextLabel({ status: "paused", nextDueAt: 1 })).toBe("已暂停")
    expect(nextLabel({ status: "done" })).toBe("已结束")
  })
  test("English dates, relative times and statuses are explicitly selectable", () => {
    const now = new Date(2026, 9, 29, 12, 0).getTime()
    expect(clockTime(now, now, "en")).toBe("Today 12:00")
    expect(clockTime(now + 86_400_000, now, "en")).toBe("Tomorrow 12:00")
    expect(clockTime(now - 86_400_000, now, "en")).toBe("Yesterday 12:00")
    expect(relativeTime(now + 30_000, now, "en")).toBe("Soon")
    expect(relativeTime(now - 30_000, now, "en")).toBe("Just now")
    expect(relativeTime(now + 60_000, now, "en")).toBe("in 1 minute")
    expect(relativeTime(now - 7_200_000, now, "en")).toBe("2 hours ago")
    expect(relativeTime(now + 172_800_000, now, "en")).toBe("in 2 days")
    expect(nextLabel({ status: "paused" }, now, "en")).toBe("Paused")
    expect(nextLabel({ status: "done" }, now, "en")).toBe("Done")
    expect(clockTime(undefined, now, "en")).toBe("—")
  })
})
