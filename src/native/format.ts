import type { Automation } from "./model"
import { words, type Language } from "./i18n"

export const STATUS_GLYPHS = { active: "●", paused: "‖", done: "✓" } as const

const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u

/** Terminal columns of one character: CJK and emoji take two. */
function charColumns(char: string) {
  return WIDE.test(char) ? 2 : 1
}

export function columns(text: string) {
  let total = 0
  for (const char of text) total += charColumns(char)
  return total
}

/** Exactly `width` columns: cut with "…" when too long, padded with spaces when short. */
export function fit(text: string, width: number, align: "left" | "right" = "left") {
  if (width <= 0) return ""
  let used = 0
  let out = ""
  if (columns(text) > width) {
    for (const char of text) {
      const size = charColumns(char)
      if (used + size > width - 1) break
      out += char
      used += size
    }
    out += "…"
    used += 1
  } else {
    out = text
    used = columns(text)
  }
  const pad = " ".repeat(Math.max(0, width - used))
  return align === "right" ? pad + out : out + pad
}

const pad2 = (value: number) => String(value).padStart(2, "0")

function dayDiff(value: Date, now: Date) {
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((start(value) - start(now)) / 86_400_000)
}

/** "今天 09:00", "明天 09:00", "11-03 09:00" or "2027-01-02 09:00". */
export function clockTime(ms: number | undefined, now = Date.now(), language: Language = "zh") {
  if (ms === undefined) return "—"
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return "—"
  const current = new Date(now)
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const days = dayDiff(date, current)
  const text = words(language)
  if (days === 0) return `${text.today} ${time}`
  if (days === 1) return `${text.tomorrow} ${time}`
  if (days === -1) return `${text.yesterday} ${time}`
  const day = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return date.getFullYear() === current.getFullYear() ? `${day} ${time}` : `${date.getFullYear()}-${day} ${time}`
}

/** "3 分钟后", "2 小时前", "刚刚". */
export function relativeTime(ms: number | undefined, now = Date.now(), language: Language = "zh") {
  if (ms === undefined) return "—"
  const diff = ms - now
  const abs = Math.abs(diff)
  const text = words(language)
  if (abs < 60_000) return diff >= 0 ? text.soon : text.justNow
  const minutes = Math.round(abs / 60_000)
  const hours = Math.round(abs / 3_600_000)
  const [value, unit] = minutes < 60 ? [minutes, "minute"] as const
    : hours < 24 ? [hours, "hour"] as const
    : [Math.round(abs / 86_400_000), "day"] as const
  return text.relative(value, unit, diff >= 0)
}

/** The list's right column: when it runs next, or why it won't. */
export function nextLabel(row: Pick<Automation, "status" | "nextDueAt"> & { trigger?: Pick<Automation["trigger"], "type"> },
  now = Date.now(), language: Language = "zh", format: "relative" | "absolute" = "relative") {
  const text = words(language)
  if (row.status === "done") return text.statuses.done
  if (row.status === "paused") return text.statuses.paused
  if (row.nextDueAt !== undefined)
    return format === "absolute" ? clockTime(row.nextDueAt, now, language) : relativeTime(row.nextDueAt, now, language)
  // An event watch has no due time; it runs whenever its MCP server pushes.
  return row.trigger?.type === "event" ? text.onEvent : "—"
}
