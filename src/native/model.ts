/** Native schedules belong to sessions, not filesystem scheduler scopes. */
export type ScheduleWhen =
  | { type: "in"; in: string; tz?: string }
  | { type: "at"; at: string; tz?: string }
  | { type: "every"; every: string; tz?: string }
  | { type: "cron"; cron: string; tz?: string }

export type NativeSchedule = {
  id: string
  sessionID?: string
  name?: string
  prompt: string
  when: ScheduleWhen
  tz: string
  status: "active" | "paused" | "done"
  nextDueAt?: number
  endsAt?: number
  remainingRuns?: number
  runCount: number
  lastFiredAt?: number
  lastOutcome?: "fired" | "late" | "skipped" | "disabled" | "failed"
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
      row.session?.model?.providerID, row.session?.model?.variant, describeWhen(row.when), row.tz]
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
