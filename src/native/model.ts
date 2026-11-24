/** Mirrors `Automation.Info` from OpenCode 2.4; timestamps are epoch milliseconds. */
export type AutomationTrigger =
  | { type: "at"; at: string; tz?: string }
  | { type: "every"; every: string; tz?: string }
  | { type: "cron"; cron: string; tz?: string }
  | { type: "event"; server: string; event: string; args?: Record<string, unknown> }

export type AutomationTarget = { session: string; subagent?: never } | { subagent: string; session?: never }

export type AutomationAction =
  | { type: "prompt"; prompt: string; to: AutomationTarget }
  | { type: "code"; code: string; args?: unknown }
  | { type: "shell"; command: string }

export type AutomationActionType = AutomationAction["type"]
export type AutomationStatus = "active" | "paused" | "done"
export type AutomationOutcome = "fired" | "late" | "skipped" | "disabled" | "failed" | "expired"

export type Automation = {
  id: string
  name: string
  projectID?: string
  /** The session that created it. Deleting that session does not delete the automation. */
  sessionID?: string
  directory: string
  trigger: AutomationTrigger
  tz: string
  action: AutomationAction
  expires?: number
  status: AutomationStatus
  nextDueAt?: number
  runCount: number
  lastRunAt?: number
  lastOutcome?: AutomationOutcome
  lastOutput?: string
  time?: { created: number; updated: number }
}

/** What the TUI already knows about a session; never fetched just for this window. */
export type AutomationSession = { id: string; title?: string }
export type AutomationRow = Automation & { session?: AutomationSession; target?: AutomationSession }
export type AutomationFilter = "all" | AutomationStatus
/** `created` keeps the service's order (oldest first). */
export type AutomationSort = "created" | "next" | "name"

/** The session a prompt lands in: an explicit target, else the creator (code sends and subagent runs start there). */
export function targetSessionID(row: Automation): string | undefined {
  return row.action.type === "prompt" && row.action.to.session ? row.action.to.session : row.sessionID
}

/** Whether an automation concerns a session: created there, or prompting it. */
export function belongsTo(row: Automation, sessionID: string | undefined) {
  return !!sessionID && (row.sessionID === sessionID || targetSessionID(row) === sessionID)
}

/** The body of an action: its prompt, script or command. */
export function actionBody(action: AutomationAction): string {
  switch (action.type) {
    case "prompt": return action.prompt
    case "code": return action.code
    case "shell": return action.command
  }
}

export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "at": return `单次 ${trigger.at}`
    case "every": return `每隔 ${trigger.every}`
    case "cron": return `Cron ${trigger.cron}`
    case "event": return `MCP ${trigger.server}/${trigger.event}`
  }
}

export function selectAutomations(rows: AutomationRow[], options: {
  status?: AutomationFilter
  sessionID?: string
  query?: string
} = {}): AutomationRow[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? ""
  return rows.filter((row) => {
    if (options.status && options.status !== "all" && row.status !== options.status) return false
    if (options.sessionID && !belongsTo(row, options.sessionID)) return false
    const action = row.action
    return !query || [row.id, row.name, actionBody(action), action.type,
      action.type === "prompt" ? action.to.subagent ?? action.to.session : undefined,
      row.sessionID, row.session?.title, row.target?.title, row.directory,
      describeTrigger(row.trigger), row.tz, row.lastOutput]
      .some((value) => value?.toLocaleLowerCase().includes(query))
  })
}

/** Where a row falls when sorting by next run: due timers first, then event watches, paused and done. */
function nextRank(row: Automation) {
  if (row.status === "active") return row.nextDueAt !== undefined ? 0 : 1
  return row.status === "paused" ? 2 : 3
}

/** A sorted copy. Ties keep the service's creation order, since `Array.prototype.sort` is stable. */
export function sortAutomations<Row extends Automation>(rows: Row[], sort: AutomationSort, locale?: string): Row[] {
  if (sort === "created") return rows
  const name = (row: Automation) => row.name || actionBody(row.action)
  return [...rows].sort((a, b) => sort === "name"
    ? name(a).localeCompare(name(b), locale, { numeric: true, sensitivity: "base" })
    : nextRank(a) - nextRank(b) || (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0))
}

export function countAutomations(rows: Automation[]) {
  return rows.reduce((counts, row) => {
    counts.all++
    counts[row.status]++
    return counts
  }, { all: 0, active: 0, paused: 0, done: 0 })
}
