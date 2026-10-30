/** Native schedules belong to sessions, not filesystem scheduler scopes. */
export type ScheduleWhen =
  | { type: "in"; in: string; tz?: string }
  | { type: "at"; at: string; tz?: string }
  | { type: "every"; every: string; tz?: string }
  | { type: "cron"; cron: string; tz?: string }

/**
 * A gate the service evaluates before waking the session, with no model call. At most one predicate out of `is`,
 * `matches` and `changes` applies; with none of them, exit code 0 alone passes.
 */
export type ScheduleCondition =
  | { type: "shell"; run: string; is?: string; matches?: string; changes?: boolean }
  | { type: "code"; code: string }

/** `if` gates every recurring slot; `until` polls until it passes once. The service stores at most one of them. */
export type ScheduleCheckMode = "if" | "until"
export type ScheduleCheck = { mode: ScheduleCheckMode; condition: ScheduleCondition }

export type ScheduleOutcome = "fired" | "late" | "checked" | "expired" | "skipped" | "disabled" | "failed"

export type NativeSchedule = {
  id: string
  sessionID?: string
  name?: string
  prompt: string
  when: ScheduleWhen
  tz: string
  if?: ScheduleCondition
  until?: ScheduleCondition
  status: "active" | "paused" | "done"
  nextDueAt?: number
  endsAt?: number
  remainingRuns?: number
  runCount: number
  lastFiredAt?: number
  lastOutcome?: ScheduleOutcome
  time?: { created: number; updated: number }
}

export type ScheduleSession = {
  id: string
  title?: string
  directory?: string
  agent?: string
  /** Current session selection, not the configuration of any historical schedule firing. */
  model?: { id: string; providerID: string; variant?: string }
}
export type ScheduleRow = NativeSchedule & { session?: ScheduleSession }
export type ScheduleFilter = "all" | NativeSchedule["status"]

export function describeWhen(when: ScheduleWhen): string {
  switch (when.type) {
    case "in": return `延时 ${when.in}`
    case "at": return `指定时间 ${when.at}`
    case "every": return `每隔 ${when.every}`
    case "cron": return `Cron ${when.cron}`
  }
}

/** The single gate stored on a schedule, if any. */
export function scheduleCheck(row: NativeSchedule): ScheduleCheck | undefined {
  if (row.if) return { mode: "if", condition: row.if }
  if (row.until) return { mode: "until", condition: row.until }
  return undefined
}

/** Mirrors the service's own condition summary: the command itself, or the first non-empty line of a code check. */
export function describeCondition(condition: ScheduleCondition): string {
  if (condition.type === "shell") return condition.run
  const line = condition.code.split("\n").map((item) => item.trim()).find((item) => item.length > 0)
  return line ? `code (${line.slice(0, 60)})` : "code"
}

/** Searchable text for a gate, including its predicate so `changes` or a regex can be found. */
function conditionHaystack(condition: ScheduleCondition | undefined) {
  if (!condition) return []
  if (condition.type === "code") return [condition.code]
  return [condition.run, condition.is, condition.matches, condition.changes ? "changes" : undefined]
}

export function selectSchedules(rows: ScheduleRow[], options: {
  status?: ScheduleFilter
  sessionID?: string
  query?: string
} = {}): ScheduleRow[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? ""
  return rows.filter((row) => {
    if (options.status && options.status !== "all" && row.status !== options.status) return false
    if (options.sessionID && row.sessionID !== options.sessionID) return false
    return !query || [row.id, row.name, row.prompt, row.sessionID, row.session?.title,
      row.session?.directory, row.session?.agent, row.session?.model?.id,
      row.session?.model?.providerID, row.session?.model?.variant, describeWhen(row.when), row.tz,
      row.if ? "if" : undefined, row.until ? "until" : undefined,
      ...conditionHaystack(row.if), ...conditionHaystack(row.until)]
      .some((value) => value?.toLocaleLowerCase().includes(query))
  })
}

export function countSchedules(rows: NativeSchedule[]) {
  return rows.reduce((counts, row) => {
    counts.all++
    counts[row.status]++
    return counts
  }, { all: 0, active: 0, paused: 0, done: 0 })
}
