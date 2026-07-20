import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import {
  deleteSchedulerJob,
  getSchedulerStatus,
  pauseSchedulerJob,
  removeOrphanArtifact,
  resumeSchedulerJob,
  runSchedulerJob,
  schedulerJobLogs,
  updateSchedulerJobSchedule,
} from "./index.js"
import { deriveStatusScopeId, type SchedulerHealth, type SchedulerJobStatus, type SchedulerOrphanStatus, type SchedulerStatusSnapshot } from "./status.js"

const id = "opencode-scheduler"
const EMPTY: SchedulerStatusSnapshot = {
  scannedAt: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  jobs: [],
  orphans: [],
  diagnostics: [],
  summary: { total: 0, healthy: 0, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
}

type Filter = "all" | "running" | "paused" | "problems"

export function filterSchedulerJobs(
  jobs: SchedulerJobStatus[],
  options: { query?: string; filter?: Filter; scopeId?: string }
): SchedulerJobStatus[] {
  const needle = options.query?.trim().toLowerCase() || ""
  const problems = new Set<SchedulerHealth>(["disabled", "missing", "drifted", "error"])
  return jobs.filter((job) => {
    if (needle && !`${job.name} ${job.slug} ${job.workdir}`.toLowerCase().includes(needle)) return false
    if (options.scopeId && job.scopeId !== options.scopeId) return false
    if (options.filter === "running" && job.health !== "running") return false
    if (options.filter === "paused" && job.health !== "paused") return false
    if (options.filter === "problems" && !problems.has(job.health)) return false
    return true
  })
}

function createStatusStore(api: TuiPluginApi) {
  const [snapshot, setSnapshot] = createSignal(EMPTY)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const refresh = async () => {
    if (loading()) return
    setLoading(true)
    try {
      setSnapshot(getSchedulerStatus({ allScopes: true, includeLegacy: true, verifySystem: true }))
      setError(undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      api.ui.toast({ variant: "error", title: "Scheduler", message })
    } finally {
      setLoading(false)
    }
  }

  void refresh()
  const timer = setInterval(() => void refresh(), 10_000)
  api.lifecycle.onDispose(() => clearInterval(timer))
  return { snapshot, loading, error, refresh }
}

function statusIcon(status: SchedulerHealth) {
  if (status === "healthy") return "●"
  if (status === "running") return "◉"
  if (status === "paused") return "Ⅱ"
  return "!"
}

function statusColor(api: TuiPluginApi, status: SchedulerHealth) {
  if (status === "healthy") return api.theme.current.success
  if (status === "running") return api.theme.current.info
  if (status === "paused") return api.theme.current.textMuted
  return api.theme.current.warning
}

function relativeTime(value: string | null) {
  if (!value) return "—"
  const delta = Date.parse(value) - Date.now()
  const abs = Math.abs(delta)
  const suffix = delta >= 0 ? "from now" : "ago"
  if (abs < 60_000) return "less than a minute"
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`
  return `${Math.round(abs / 86_400_000)}d ${suffix}`
}

function Sidebar(props: { api: TuiPluginApi; store: ReturnType<typeof createStatusStore> }) {
  const jobs = createMemo(() => props.store.snapshot().jobs.slice(0, 5))
  const problems = createMemo(() => {
    const summary = props.store.snapshot().summary
    return summary.disabled + summary.missing + summary.drifted + summary.orphaned + summary.error
  })
  return (
    <box gap={1} paddingTop={1}>
      <box flexDirection="row" justifyContent="space-between" onMouseUp={() => props.api.route.navigate("scheduler")}>
        <text fg={props.api.theme.current.text}><b>Scheduled tasks</b></text>
        <text fg={problems() ? props.api.theme.current.warning : props.api.theme.current.textMuted}>
          {props.store.snapshot().summary.total}{problems() ? ` · ${problems()} issues` : ""}
        </text>
      </box>
      <For each={jobs()}>
        {(job) => (
          <box paddingLeft={1} onMouseUp={() => props.api.route.navigate("scheduler-detail", { id: job.id })}>
            <text fg={statusColor(props.api, job.health)}>{statusIcon(job.health)} <span style={{ fg: props.api.theme.current.text }}>{job.name}</span></text>
            <text fg={props.api.theme.current.textMuted}>{job.scheduleText} · {relativeTime(job.nextRunAt)}</text>
          </box>
        )}
      </For>
      <Show when={!jobs().length}>
        <text fg={props.api.theme.current.textMuted}>No scheduled tasks</text>
      </Show>
      <text fg={props.api.theme.current.primary} onMouseUp={() => props.api.route.navigate("scheduler")}>Open task center →</text>
    </box>
  )
}

function Header(props: { api: TuiPluginApi; title: string; back?: () => void; refresh: () => void; loading: boolean }) {
  return (
    <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
      <box flexDirection="row" gap={2}>
        <Show when={props.back}><text fg={props.api.theme.current.primary} onMouseUp={() => props.back?.()}>← Back</text></Show>
        <text fg={props.api.theme.current.text}><b>{props.title}</b></text>
      </box>
      <text fg={props.api.theme.current.textMuted} onMouseUp={props.refresh}>{props.loading ? "Refreshing…" : "↻ Refresh"}</text>
    </box>
  )
}

function TaskCenter(props: { api: TuiPluginApi; store: ReturnType<typeof createStatusStore> }) {
  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal<Filter>("all")
  const [scope, setScope] = createSignal<"all" | "current">("all")
  const currentScopeId = createMemo(() => deriveStatusScopeId(props.api.state.path.directory))
  const jobs = createMemo(() => filterSchedulerJobs(props.store.snapshot().jobs, {
    query: query(),
    filter: filter(),
    scopeId: scope() === "current" ? currentScopeId() : undefined,
  }))
  const options = createMemo(() => jobs().map((job) => ({
    name: `${statusIcon(job.health)} ${job.name}`,
    description: `${job.scheduleText} · next ${relativeTime(job.nextRunAt)} · ${job.workdir}`,
    value: job.id,
  })))
  onMount(() => void props.store.refresh())
  return (
    <box width="100%" height="100%" padding={2} flexDirection="column">
      <Header api={props.api} title="Scheduled tasks" refresh={() => void props.store.refresh()} loading={props.store.loading()} />
      <input
        value={query()}
        placeholder="Search scheduled tasks"
        onInput={setQuery}
        backgroundColor={props.api.theme.current.backgroundElement}
        textColor={props.api.theme.current.text}
        focusedTextColor={props.api.theme.current.text}
      />
      <box flexDirection="row" gap={2} paddingTop={1} paddingBottom={1}>
        <text fg={scope() === "all" ? props.api.theme.current.primary : props.api.theme.current.textMuted} onMouseUp={() => setScope("all")}>All projects</text>
        <text fg={scope() === "current" ? props.api.theme.current.primary : props.api.theme.current.textMuted} onMouseUp={() => setScope("current")}>Current project</text>
        <text fg={props.api.theme.current.border}>│</text>
        <For each={["all", "running", "paused", "problems"] as Filter[]}>
          {(item) => (
            <text
              fg={filter() === item ? props.api.theme.current.primary : props.api.theme.current.textMuted}
              onMouseUp={() => setFilter(item)}
            >{item === "all" ? "All" : item === "running" ? "Running" : item === "paused" ? "Paused" : "Problems"}</text>
          )}
        </For>
      </box>
      <Show when={options().length} fallback={<text fg={props.api.theme.current.textMuted}>No matching tasks.</text>}>
        <select
          options={options()}
          focused
          flexGrow={1}
          showDescription
          showScrollIndicator
          backgroundColor={props.api.theme.current.background}
          textColor={props.api.theme.current.text}
          descriptionColor={props.api.theme.current.textMuted}
          selectedBackgroundColor={props.api.theme.current.backgroundElement}
          selectedTextColor={props.api.theme.current.text}
          onSelect={(_, option) => {
            if (typeof option?.value === "string") props.api.route.navigate("scheduler-detail", { id: option.value })
          }}
        />
      </Show>
      <Show when={props.store.snapshot().orphans.length}>
        <box paddingTop={1}>
          <text fg={props.api.theme.current.warning}><b>Orphaned OS tasks ({props.store.snapshot().orphans.length})</b></text>
          <For each={props.store.snapshot().orphans}>
            {(orphan) => <text fg={props.api.theme.current.warning} onMouseUp={() => openOrphanDialog(props.api, props.store, orphan)}>! {orphan.slug} · {orphan.backend} · click to inspect</text>}
          </For>
        </box>
      </Show>
      <text fg={props.api.theme.current.textMuted}>Mouse: click task · Keyboard: ↑/↓ and Enter · Refreshes every 10 seconds</text>
    </box>
  )
}

function perform(api: TuiPluginApi, store: ReturnType<typeof createStatusStore>, action: () => unknown, success: string) {
  try {
    action()
    api.ui.toast({ variant: "success", title: "Scheduler", message: success })
    void store.refresh()
  } catch (error) {
    api.ui.toast({ variant: "error", title: "Scheduler", message: error instanceof Error ? error.message : String(error) })
  }
}

function openScheduleDialog(api: TuiPluginApi, store: ReturnType<typeof createStatusStore>, job: SchedulerJobStatus) {
  const DialogPrompt = api.ui.DialogPrompt
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title={`Change schedule · ${job.name}`}
      description={() => <text fg={api.theme.current.textMuted}>Five-field cron expression. Current: {job.schedule}</text>}
      value={job.schedule}
      onConfirm={(value) => {
        perform(api, store, () => updateSchedulerJobSchedule({ id: job.id }, value), "Schedule updated")
        api.ui.dialog.clear()
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function openLogs(api: TuiPluginApi, job: SchedulerJobStatus) {
  const Dialog = api.ui.Dialog
  let result: ReturnType<typeof schedulerJobLogs>
  try {
    result = schedulerJobLogs({ id: job.id }, 300)
  } catch (error) {
    api.ui.toast({
      variant: "error",
      title: "Scheduler",
      message: error instanceof Error ? error.message : String(error),
    })
    return
  }
  api.ui.dialog.replace(() => (
    <Dialog size="xlarge" onClose={() => api.ui.dialog.clear()}>
      <box flexDirection="column" width="100%" height="100%" gap={1}>
        <text fg={api.theme.current.text}><b>Logs · {job.name}</b></text>
        <text fg={api.theme.current.textMuted}>{result.logPath}</text>
        <scrollbox flexGrow={1}><text fg={api.theme.current.text}>{result.logs || "No logs yet."}</text></scrollbox>
        <text fg={api.theme.current.textMuted} onMouseUp={() => api.ui.dialog.clear()}>esc · close</text>
      </box>
    </Dialog>
  ))
  api.ui.dialog.setSize("xlarge")
}

function confirmDelete(api: TuiPluginApi, store: ReturnType<typeof createStatusStore>, job: SchedulerJobStatus) {
  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title={`Delete ${job.name}?`}
      message="This removes the job configuration and its OS scheduler entry. Logs are retained."
      onConfirm={() => {
        perform(api, store, () => deleteSchedulerJob({ id: job.id }), "Task deleted")
        api.ui.dialog.clear()
        api.route.navigate("scheduler")
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function openOrphanDialog(api: TuiPluginApi, store: ReturnType<typeof createStatusStore>, orphan: SchedulerOrphanStatus) {
  const DialogConfirm = api.ui.DialogConfirm
  const ids = orphan.artifactIds.join("\n")
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title={`Remove orphan ${orphan.slug}?`}
      message={`Backend: ${orphan.backend}\nArtifacts:\n${ids}\n\nOnly these exact scheduler artifacts will be removed.`}
      onConfirm={() => {
        perform(api, store, () => orphan.artifactIds.forEach((artifactId) => removeOrphanArtifact(artifactId, true)), "Orphan removed")
        api.ui.dialog.clear()
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function Action(props: { api: TuiPluginApi; label: string; onSelect: () => void; warning?: boolean }) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.api.theme.current.backgroundElement}
      onMouseUp={props.onSelect}
    >
      <text fg={props.warning ? props.api.theme.current.warning : props.api.theme.current.primary}>{props.label}</text>
    </box>
  )
}

function Detail(props: { api: TuiPluginApi; store: ReturnType<typeof createStatusStore>; id?: string }) {
  const job = createMemo(() => props.store.snapshot().jobs.find((item) => item.id === props.id))
  onMount(() => void props.store.refresh())
  return (
    <box width="100%" height="100%" padding={2} flexDirection="column">
      <Header api={props.api} title={job()?.name || "Scheduled task"} back={() => props.api.route.navigate("scheduler")} refresh={() => void props.store.refresh()} loading={props.store.loading()} />
      <Show when={job()} fallback={<text fg={props.api.theme.current.warning}>Task not found. Refresh or return to the task center.</text>}>
        {(item) => (
          <scrollbox flexGrow={1}>
            <box gap={1} paddingRight={1}>
              <text fg={statusColor(props.api, item().health)}><b>{statusIcon(item().health)} {item().health.toUpperCase()}</b></text>
              <box border borderColor={props.api.theme.current.border} padding={1}>
                <text fg={props.api.theme.current.text}><b>Task</b></text>
                <text fg={props.api.theme.current.text}>{item().prompt || item().command || "No prompt or command"}</text>
              </box>
              <box border borderColor={props.api.theme.current.border} padding={1}>
                <text fg={props.api.theme.current.text}><b>Details</b></text>
                <text fg={props.api.theme.current.textMuted}>Project  <span style={{ fg: props.api.theme.current.text }}>{item().workdir}</span></text>
                <text fg={props.api.theme.current.textMuted}>Scope    <span style={{ fg: props.api.theme.current.text }}>{item().scopeId}</span></text>
                <text fg={props.api.theme.current.textMuted}>Backend  <span style={{ fg: props.api.theme.current.text }}>{item().backend || "not registered"}</span></text>
                <text fg={props.api.theme.current.textMuted}>Registered <span style={{ fg: props.api.theme.current.text }}>{item().artifacts.some((artifact) => artifact.registered) ? "yes" : "no"}</span></text>
                <text fg={props.api.theme.current.textMuted}>Model    <span style={{ fg: props.api.theme.current.text }}>{item().model || "default"}</span></text>
                <text fg={props.api.theme.current.textMuted}>Agent    <span style={{ fg: props.api.theme.current.text }}>{item().agent || "default"}</span></text>
                <text fg={props.api.theme.current.textMuted}>Timeout  <span style={{ fg: props.api.theme.current.text }}>{item().timeoutSeconds ? `${item().timeoutSeconds}s` : "default"}</span></text>
              </box>
              <box border borderColor={props.api.theme.current.border} padding={1}>
                <text fg={props.api.theme.current.text}><b>Frequency</b></text>
                <text fg={props.api.theme.current.textMuted}>Cron      <span style={{ fg: props.api.theme.current.text }}>{item().schedule}</span></text>
                <text fg={props.api.theme.current.textMuted}>Readable  <span style={{ fg: props.api.theme.current.text }}>{item().scheduleText}</span></text>
                <text fg={props.api.theme.current.textMuted}>Timezone  <span style={{ fg: props.api.theme.current.text }}>{item().timezone}</span></text>
                <text fg={props.api.theme.current.textMuted}>Next run  <span style={{ fg: props.api.theme.current.text }}>{item().nextRunAt || "—"}</span></text>
                <text fg={props.api.theme.current.textMuted}>Last run  <span style={{ fg: props.api.theme.current.text }}>{item().lastRunAt ? `${item().lastRunAt} · ${item().lastRunStatus || "unknown"}` : "—"}</span></text>
              </box>
              <Show when={item().diagnostics.length}>
                <box border borderColor={props.api.theme.current.warning} padding={1}>
                  <text fg={props.api.theme.current.warning}><b>Diagnostics</b></text>
                  <For each={item().diagnostics}>{(message) => <text fg={props.api.theme.current.warning}>! {message}</text>}</For>
                </box>
              </Show>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <Action api={props.api} label="Run now" onSelect={() => perform(props.api, props.store, () => runSchedulerJob({ id: item().id }), "Task started")} />
                <Action
                  api={props.api}
                  label={item().enabled ? "Pause" : "Resume"}
                  onSelect={() => perform(props.api, props.store, () => item().enabled ? pauseSchedulerJob({ id: item().id }) : resumeSchedulerJob({ id: item().id }), item().enabled ? "Task paused" : "Task resumed")}
                />
                <Action api={props.api} label="Edit frequency" onSelect={() => openScheduleDialog(props.api, props.store, item())} />
                <Action api={props.api} label="View logs" onSelect={() => openLogs(props.api, item())} />
                <Action api={props.api} label="Delete" warning onSelect={() => confirmDelete(props.api, props.store, item())} />
              </box>
              <box paddingTop={1}>
                <text fg={props.api.theme.current.text}><b>Run history</b></text>
                <Show when={item().runHistory.length} fallback={<text fg={props.api.theme.current.textMuted}>No recorded runs yet.</text>}>
                  <For each={item().runHistory}>
                    {(run) => <text fg={run.status === "success" ? props.api.theme.current.success : props.api.theme.current.warning}>• {run.startedAt || "unknown"} · {run.source || "scheduled"} · {run.status || "unknown"} · {run.durationMs ?? 0}ms</text>}
                  </For>
                </Show>
              </box>
            </box>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const store = createStatusStore(api)
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content() {
        return <Sidebar api={api} store={store} />
      },
    },
  })
  api.route.register([
    { name: "scheduler", render: () => <TaskCenter api={api} store={store} /> },
    { name: "scheduler-detail", render: ({ params }) => <Detail api={api} store={store} id={typeof params?.id === "string" ? params.id : undefined} /> },
  ])
  api.command?.register(() => [{
    title: "Open scheduled tasks",
    value: "scheduler.open",
    description: "Browse and manage OS-verified scheduled tasks",
    category: "Scheduler",
    suggested: true,
    slash: { name: "scheduler", aliases: ["schedules", "tasks"] },
    onSelect: () => {
      api.ui.dialog.clear()
      api.route.navigate("scheduler")
    },
  }])
}

export { id, tui }
export default { id, tui }
