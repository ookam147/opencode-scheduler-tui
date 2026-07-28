import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { BoxRenderable, InputRenderable, MouseEvent as OpenTuiMouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { Accessor, JSX } from "solid-js"
import { existsSync, watch, type FSWatcher } from "fs"
import { homedir } from "os"
import { join } from "path"
import {
  deleteSchedulerJob,
  getSchedulerStatus,
  moveSchedulerJob,
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

export type Filter = "all" | "active" | "paused" | "problems"
export type ScopeMode = "all" | "current"
type TaskCenterFocus = "list" | "controls" | "search"

export type SchedulerCenterState = {
  scope?: ScopeMode
  filter?: Filter
  query?: string
  selectedId?: string
}

type SchedulerRouteParams = {
  id?: string
  entry?: "sidebar" | "center" | "command"
  returnRoute?: TuiRouteCurrent
  centerState?: SchedulerCenterState
}

function routeParams(api: TuiPluginApi): SchedulerRouteParams {
  if (!("params" in api.route.current)) return {}
  return (api.route.current.params || {}) as SchedulerRouteParams
}

function navigateBack(api: TuiPluginApi, returnRoute?: TuiRouteCurrent) {
  const target = returnRoute || routeParams(api).returnRoute
  if (target?.name === "scheduler" || target?.name === "scheduler-detail") {
    api.route.navigate("home")
    return
  }
  api.route.navigate(target?.name || "home", target && "params" in target ? target.params : undefined)
}

function navigateToDetail(api: TuiPluginApi, input: { id: string; entry: "sidebar" | "center"; returnRoute?: TuiRouteCurrent; centerState?: SchedulerCenterState }) {
  api.route.navigate("scheduler-detail", {
    id: input.id,
    entry: input.entry,
    returnRoute: input.returnRoute || routeParams(api).returnRoute,
    centerState: input.centerState,
  })
}

export function filterSchedulerJobs(
  jobs: SchedulerJobStatus[],
  options: { query?: string; filter?: Filter; scopeId?: string }
): SchedulerJobStatus[] {
  const needle = options.query?.trim().toLowerCase() || ""
  const problems = new Set<SchedulerHealth>(["disabled", "missing", "drifted", "error"])
  return jobs.filter((job) => {
    if (needle && !`${job.name} ${job.slug} ${job.workdir} ${job.scheduleText} ${job.model || ""} ${job.agent || ""}`.toLowerCase().includes(needle)) return false
    if (options.scopeId && job.scopeId !== options.scopeId) return false
    if (options.filter === "active" && job.enabled === false) return false
    if (options.filter === "paused" && job.health !== "paused") return false
    if (options.filter === "problems" && !problems.has(job.health)) return false
    return true
  })
}

export type StatusStoreOptions = {
  schedulerRoot?: string
  loadStatus?: () => SchedulerStatusSnapshot
  debounceMs?: number
  fallbackMs?: number
  verificationMs?: number
}

export type StatusStore = {
  snapshot: Accessor<SchedulerStatusSnapshot>
  loading: Accessor<boolean>
  error: Accessor<string | undefined>
  refresh: () => Promise<void>
  scheduleRefresh: () => void
}

export function createStatusStore(api: TuiPluginApi, options: StatusStoreOptions = {}): StatusStore {
  const [snapshot, setSnapshot] = createSignal(EMPTY)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  let refreshPending = false
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setInterval> | undefined
  let watcher: FSWatcher | undefined
  let watcherWarningShown = false

  const refresh = async () => {
    if (loading()) {
      refreshPending = true
      return
    }
    setLoading(true)
    do {
      refreshPending = false
      try {
        setSnapshot(options.loadStatus?.() || getSchedulerStatus({ allScopes: true, includeLegacy: true, verifySystem: true }))
        setError(undefined)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message)
        api.ui.toast({ variant: "error", title: "Scheduler", message })
      }
    } while (refreshPending)
    setLoading(false)
  }

  const scheduleRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void refresh(), options.debounceMs ?? 250)
  }

  const schedulerRoot = options.schedulerRoot || join(homedir(), ".config", "opencode", "scheduler")
  const startFallback = () => {
    if (fallbackTimer) return
    if (!watcherWarningShown) {
      watcherWarningShown = true
      console.warn("[opencode-scheduler] scheduler file watching unavailable; using 2 second refresh fallback")
    }
    fallbackTimer = setInterval(() => {
      void refresh()
      startWatcher()
    }, options.fallbackMs ?? 2_000)
  }
  const startWatcher = () => {
    if (watcher || !existsSync(schedulerRoot)) {
      if (!watcher) startFallback()
      return
    }
    try {
      watcher = watch(schedulerRoot, { recursive: true }, scheduleRefresh)
      watcher.on("error", () => {
        watcher?.close()
        watcher = undefined
        startFallback()
      })
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = undefined
      }
    } catch {
      startFallback()
    }
  }

  void refresh()
  startWatcher()
  const verificationTimer = setInterval(() => void refresh(), options.verificationMs ?? 10_000)
  api.lifecycle.onDispose(() => {
    clearInterval(verificationTimer)
    if (fallbackTimer) clearInterval(fallbackTimer)
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher?.close()
  })
  return { snapshot, loading, error, refresh, scheduleRefresh }
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

function inside(renderable: BoxRenderable | undefined, event: OpenTuiMouseEvent) {
  if (!renderable) return false
  return event.x >= renderable.x
    && event.x < renderable.x + renderable.width
    && event.y >= renderable.y
    && event.y < renderable.y + renderable.height
}

const handledMouseReleases = new WeakSet<OpenTuiMouseEvent>()

function activateMouse(event: OpenTuiMouseEvent, action: () => void) {
  if (event.button !== 0) return
  if (handledMouseReleases.has(event)) return
  handledMouseReleases.add(event)
  event.preventDefault()
  event.stopPropagation()
  action()
}

export function Sidebar(props: { api: TuiPluginApi; store: StatusStore }): JSX.Element {
  const [open, setOpen] = createSignal(props.api.kv?.get("scheduler.sidebar.expanded", true) ?? true)
  const currentScopeId = createMemo(() => deriveStatusScopeId(props.api.state.path.directory))
  const jobs = createMemo(() => props.store.snapshot().jobs.filter((job) => job.scopeId === currentScopeId()))
  const recentJobs = createMemo(() => jobs().slice(0, 5))
  const scopedOrphans = createMemo(() => props.store.snapshot().orphans.filter((orphan) => orphan.scopeId === currentScopeId()))
  const active = createMemo(() => jobs().filter((job) => job.enabled !== false).length)
  const paused = createMemo(() => jobs().filter((job) => job.enabled === false || job.health === "paused").length)
  const problems = createMemo(() => {
    const bad = new Set<SchedulerHealth>(["disabled", "missing", "drifted", "error"])
    return jobs().filter((job) => bad.has(job.health)).length + scopedOrphans().length
  })
  const sidebarTotal = createMemo(() => active() + paused() + problems())
  let toggleTarget: BoxRenderable | undefined
  const toggle = () => {
    const next = !open()
    setOpen(next)
    props.api.kv?.set("scheduler.sidebar.expanded", next)
  }
  const openCenter = () => props.api.route.navigate("scheduler", {
    entry: "command",
    returnRoute: props.api.route.current,
    centerState: { scope: "current", filter: "all" },
  })
  const openDetail = (jobId: string) => navigateToDetail(props.api, {
    id: jobId,
    entry: "sidebar",
    returnRoute: props.api.route.current,
  })
  const handleToggle = (event: OpenTuiMouseEvent) => activateMouse(event, toggle)
  const handleRootMouse = (event: OpenTuiMouseEvent) => {
    if (inside(toggleTarget, event)) activateMouse(event, toggle)
  }
  return (
    <box gap={0} paddingTop={1} onMouseUp={handleRootMouse}>
      <box
        id="scheduler-sidebar-toggle"
        ref={(element: BoxRenderable) => (toggleTarget = element)}
        width="100%"
        height={1}
        minHeight={1}
        flexShrink={0}
        flexDirection="row"
        gap={1}
        paddingRight={1}
        onMouseUp={handleToggle}
      >
        <text id="scheduler-sidebar-toggle-icon" selectable={false} fg={props.api.theme.current.text} onMouseUp={handleToggle}>{open() ? "▼" : "▶"}</text>
        <text id="scheduler-sidebar-toggle-label" selectable={false} fg={props.api.theme.current.text} onMouseUp={handleToggle}><b>Scheduled tasks</b></text>
      </box>
      <box id="scheduler-sidebar-status" height={1} flexShrink={0} flexDirection="row" gap={1} alignItems="center">
        <text id="scheduler-sidebar-active" selectable={false} wrapMode="none" fg={props.api.theme.current.success}>● Active {active()}</text>
        <text id="scheduler-sidebar-separator-active" selectable={false} wrapMode="none" fg={props.api.theme.current.textMuted}>·</text>
        <text id="scheduler-sidebar-paused" selectable={false} wrapMode="none" fg={props.api.theme.current.primary}>Ⅱ Paused {paused()}</text>
        <text id="scheduler-sidebar-separator-paused" selectable={false} wrapMode="none" fg={props.api.theme.current.textMuted}>·</text>
        <text id="scheduler-sidebar-err" selectable={false} wrapMode="none" fg={props.api.theme.current.error}>× err {problems()}</text>
        <text id="scheduler-sidebar-separator-err" selectable={false} wrapMode="none" fg={props.api.theme.current.textMuted}>·</text>
        <box id="scheduler-sidebar-open" flexShrink={0} onMouseUp={(event) => activateMouse(event, openCenter)}>
          <text id="scheduler-sidebar-open-label" selectable={false} wrapMode="none" fg={props.api.theme.current.text}><b>→ {sidebarTotal()}</b></text>
        </box>
      </box>
      <Show when={open()}>
        <For each={recentJobs()}>
          {(job) => (
            <box id={`scheduler-sidebar-job-${job.id}`} paddingLeft={1} paddingRight={1} paddingTop={1} onMouseUp={(event) => activateMouse(event, () => openDetail(job.id))}>
              <text fg={statusColor(props.api, job.health)}>{statusIcon(job.health)} <span style={{ fg: props.api.theme.current.text }}>{job.name}</span></text>
              <text fg={props.api.theme.current.textMuted}>{job.scheduleText} · {relativeTime(job.nextRunAt)}</text>
            </box>
          )}
        </For>
        <Show when={!recentJobs().length} fallback={null}>
          <text fg={props.api.theme.current.textMuted}>No tasks in this project</text>
        </Show>
      </Show>
    </box>
  )
}

function Header(props: { api: TuiPluginApi; title: string; back?: () => void; health?: SchedulerHealth }) {
  return (
    <box id="scheduler-header" height={2} minHeight={2} flexShrink={0} flexDirection="row" gap={2}>
      <Show when={props.back} fallback={null}><text fg={props.api.theme.current.primary} onMouseUp={() => props.back?.()}>← Back</text></Show>
      <text id="scheduler-header-title" fg={props.api.theme.current.text}><b>{props.title}</b></text>
      <Show when={props.health} fallback={null}>
        {(health) => <text id="scheduler-header-health" fg={statusColor(props.api, health())}><b>{statusIcon(health())} {health().toUpperCase()}</b></text>}
      </Show>
    </box>
  )
}

export function TaskCenter(props: { api: TuiPluginApi; store: StatusStore; returnRoute?: TuiRouteCurrent; initialState?: SchedulerCenterState }): JSX.Element {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal(props.initialState?.query || "")
  const [filter, setFilter] = createSignal<Filter>(props.initialState?.filter || "all")
  const [scope, setScope] = createSignal<ScopeMode>(props.initialState?.scope || "current")
  const [focus, setFocus] = createSignal<TaskCenterFocus>("list")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [controlIndex, setControlIndex] = createSignal(scope() === "all" ? 0 : 1)
  const [hoveredControl, setHoveredControl] = createSignal<number>()
  let root: BoxRenderable | undefined
  let searchTarget: BoxRenderable | undefined
  let searchInput: InputRenderable | undefined
  let taskScroll: ScrollBoxRenderable | undefined
  const controlRefs: Array<BoxRenderable | undefined> = []
  const currentScopeId = createMemo(() => deriveStatusScopeId(props.api.state.path.directory))
  const jobs = createMemo(() => filterSchedulerJobs(props.store.snapshot().jobs, {
    query: query(),
    filter: filter(),
    scopeId: scope() === "current" ? currentScopeId() : undefined,
  }))
  const orphans = createMemo(() => {
    if (filter() === "active" || filter() === "paused") return []
    const needle = query().trim().toLowerCase()
    return props.store.snapshot().orphans.filter((orphan) => {
      if (scope() === "current" && orphan.scopeId !== currentScopeId()) return false
      if (needle && !`${orphan.slug} ${orphan.backend}`.toLowerCase().includes(needle)) return false
      return true
    })
  })
  const centerState = (): SchedulerCenterState => ({
    scope: scope(),
    filter: filter(),
    query: query(),
    selectedId: jobs()[selectedIndex()]?.id,
  })
  const focusList = () => {
    setFocus("list")
    root?.focus()
  }
  const focusControls = () => {
    setFocus("controls")
    root?.focus()
  }
  const focusSearch = () => {
    setFocus("search")
    searchInput?.focus()
  }
  const moveSelection = (delta: number) => {
    const last = jobs().length - 1
    if (last < 0) return
    setSelectedIndex((current) => Math.max(0, Math.min(last, current + delta)))
  }
  const applyControl = (index: number) => {
    setControlIndex(index)
    if (index === 0) setScope("all")
    if (index === 1) setScope("current")
    if (index === 2) setFilter("all")
    if (index === 3) setFilter("active")
    if (index === 4) setFilter("paused")
    if (index === 5) setFilter("problems")
    setSelectedIndex(0)
    taskScroll?.scrollTo(0)
    focusControls()
  }
  const moveControl = (delta: number) => setControlIndex((current) => (current + delta + 6) % 6)
  const handleControlMouse = (index: number, event: OpenTuiMouseEvent) => {
    activateMouse(event, () => applyControl(index))
  }
  const handleRootMouse = (event: OpenTuiMouseEvent) => {
    const index = controlRefs.findIndex((renderable) => inside(renderable, event))
    if (index >= 0) activateMouse(event, () => applyControl(index))
  }
  const focusSearchFromMouse = (event: OpenTuiMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    focusSearch()
  }
  const handleRootMouseDown = (event: OpenTuiMouseEvent) => {
    if (inside(searchTarget, event)) focusSearchFromMouse(event)
  }
  const openSelected = () => {
    const selected = jobs()[selectedIndex()]
    if (selected) navigateToDetail(props.api, { id: selected.id, entry: "center", returnRoute: props.returnRoute, centerState: centerState() })
  }
  const close = () => navigateBack(props.api, props.returnRoute)
  function ControlTab(tab: { index: number; id: string; label: string; selected: () => boolean }) {
    const highlighted = () => tab.selected() || hoveredControl() === tab.index || (focus() === "controls" && controlIndex() === tab.index)
    return (
      <box
        id={tab.id}
        ref={(element: BoxRenderable) => (controlRefs[tab.index] = element)}
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={highlighted() ? props.api.theme.current.backgroundElement : props.api.theme.current.background}
        onMouseUp={(event) => handleControlMouse(tab.index, event)}
        onMouseOver={() => setHoveredControl(tab.index)}
        onMouseOut={() => setHoveredControl((current) => current === tab.index ? undefined : current)}
      >
        <text
          id={`${tab.id}-label`}
          selectable={false}
          wrapMode="none"
          fg={tab.selected() || (focus() === "controls" && controlIndex() === tab.index) ? props.api.theme.current.primary : props.api.theme.current.textMuted}
          onMouseUp={(event) => handleControlMouse(tab.index, event)}
        >{tab.label}</text>
      </box>
    )
  }

  createEffect(() => {
    const last = jobs().length - 1
    const requested = props.initialState?.selectedId
    const restored = requested ? jobs().findIndex((job) => job.id === requested) : -1
    setSelectedIndex((current) => restored >= 0 ? restored : last < 0 ? 0 : Math.min(current, last))
  })

  createEffect(() => {
    const scroll = taskScroll
    if (!scroll || jobs().length === 0) return
    const rowTop = selectedIndex() * 2
    const rowBottom = rowTop + 2
    if (rowTop < scroll.scrollTop) scroll.scrollTo(rowTop)
    else if (rowBottom > scroll.scrollTop + scroll.viewport.height) {
      scroll.scrollTo(Math.max(0, rowBottom - scroll.viewport.height))
    }
  })

  createEffect(() => {
    const target = root
    const activeFocus = focus()
    if (!target || props.api.ui.dialog.open) return
    const commands = activeFocus === "list"
      ? [
          { name: "scheduler.down", run: () => moveSelection(1) },
          { name: "scheduler.up", run: () => moveSelection(-1) },
          { name: "scheduler.task.open", run: openSelected },
          { name: "scheduler.controls.focus", run: focusControls },
          { name: "scheduler.search", run: focusSearch },
          { name: "scheduler.refresh", run: () => void props.store.refresh() },
          { name: "scheduler.close", run: close },
        ]
      : activeFocus === "controls"
        ? [
            { name: "scheduler.controls.left", run: () => moveControl(-1) },
            { name: "scheduler.controls.right", run: () => moveControl(1) },
            { name: "scheduler.controls.apply", run: () => applyControl(controlIndex()) },
            { name: "scheduler.controls.done", run: focusList },
            { name: "scheduler.search", run: focusSearch },
            { name: "scheduler.refresh", run: () => void props.store.refresh() },
          ]
        : [
            { name: "scheduler.search.done", run: focusList },
            {
              name: "scheduler.search.escape",
              run: () => {
                if (query()) setQuery("")
                else focusList()
              },
            },
          ]
    const bindings = activeFocus === "list"
      ? [
          { key: "down", cmd: "scheduler.down" },
          { key: "j", cmd: "scheduler.down" },
          { key: "up", cmd: "scheduler.up" },
          { key: "k", cmd: "scheduler.up" },
          { key: "return", cmd: "scheduler.task.open" },
          { key: "linefeed", cmd: "scheduler.task.open" },
          { key: "/", cmd: "scheduler.search" },
          { key: "tab", cmd: "scheduler.controls.focus" },
          { key: "r", cmd: "scheduler.refresh" },
          { key: "escape", cmd: "scheduler.close" },
        ]
      : activeFocus === "controls"
        ? [
            { key: "left", cmd: "scheduler.controls.left" },
            { key: "h", cmd: "scheduler.controls.left" },
            { key: "right", cmd: "scheduler.controls.right" },
            { key: "l", cmd: "scheduler.controls.right" },
            { key: "return", cmd: "scheduler.controls.apply" },
            { key: "linefeed", cmd: "scheduler.controls.apply" },
            { key: "tab", cmd: "scheduler.search" },
            { key: "/", cmd: "scheduler.search" },
            { key: "r", cmd: "scheduler.refresh" },
            { key: "escape", cmd: "scheduler.controls.done" },
          ]
        : [
            { key: "tab", cmd: "scheduler.search.done" },
            { key: "escape", cmd: "scheduler.search.escape" },
          ]
    const dispose = props.api.keymap.registerLayer({
      target,
      targetMode: "focus-within",
      priority: 100,
      commands,
      bindings,
    })
    onCleanup(dispose)
  })

  onMount(() => {
    root?.focus()
    const focusTimer = setTimeout(() => {
      if (!props.api.ui.dialog.open) root?.focus()
    }, 1)
    onCleanup(() => clearTimeout(focusTimer))
    void props.store.refresh()
  })
  return (
    <box
      id="scheduler-task-center"
      ref={(element: BoxRenderable) => (root = element)}
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      minHeight={0}
      padding={2}
      flexDirection="column"
      backgroundColor={props.api.theme.current.background}
      focusable
      focused={!props.api.ui.dialog.open && focus() !== "search"}
      onMouseDown={handleRootMouseDown}
      onMouseUp={handleRootMouse}
    >
      <Header api={props.api} title="Scheduled tasks" />
      <box
        id="scheduler-search-hitbox"
        ref={(element: BoxRenderable) => (searchTarget = element)}
        width="100%"
        height={1}
        minHeight={1}
        flexShrink={0}
        onMouseDown={focusSearchFromMouse}
      >
        <input
          id="scheduler-search"
          ref={(element: InputRenderable) => (searchInput = element)}
          width="100%"
          value={query()}
          placeholder="Search scheduled tasks"
          onInput={(value) => { setQuery(String(value)); setSelectedIndex(0) }}
          onSubmit={focusList}
          focused={focus() === "search" && !props.api.ui.dialog.open}
          backgroundColor={props.api.theme.current.backgroundElement}
          textColor={props.api.theme.current.text}
          focusedTextColor={props.api.theme.current.text}
        />
      </box>
      <box height={1} flexShrink={0} />
      <box
        id="scheduler-controls"
        width="100%"
        height={1}
        minHeight={1}
        flexShrink={0}
        flexDirection="row"
        alignItems="stretch"
        gap={1}
        backgroundColor={props.api.theme.current.background}
      >
        <ControlTab index={0} id="scheduler-scope-all" label="All projects" selected={() => scope() === "all"} />
        <ControlTab index={1} id="scheduler-scope-current" label="Current project" selected={() => scope() === "current"} />
        <text selectable={false} fg={props.api.theme.current.border}>│</text>
        <ControlTab index={2} id="scheduler-filter-all" label="All" selected={() => filter() === "all"} />
        <ControlTab index={3} id="scheduler-filter-active" label="Active" selected={() => filter() === "active"} />
        <ControlTab index={4} id="scheduler-filter-paused" label="Paused" selected={() => filter() === "paused"} />
        <ControlTab index={5} id="scheduler-filter-problems" label="Problems" selected={() => filter() === "problems"} />
      </box>
      <box height={1} flexShrink={0} />
      <box id="scheduler-results" flexGrow={1} minHeight={0} flexDirection="column">
        <Show when={jobs().length} fallback={<text fg={props.api.theme.current.textMuted}>No matching tasks.</text>}>
          <scrollbox
            id="scheduler-task-list"
            ref={(element: ScrollBoxRenderable) => (taskScroll = element)}
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: jobs().length > 8 }}
          >
            <For each={jobs()}>
              {(job, index) => (
                <box
                  id={`scheduler-job-${job.id}`}
                  height={2}
                  flexShrink={0}
                  flexDirection="column"
                  paddingLeft={1}
                  backgroundColor={selectedIndex() === index() ? props.api.theme.current.backgroundElement : props.api.theme.current.background}
                  onMouseUp={(event) => activateMouse(event, () => {
                    setSelectedIndex(index())
                    focusList()
                    navigateToDetail(props.api, { id: job.id, entry: "center", returnRoute: props.returnRoute, centerState: centerState() })
                  })}
                >
                  <text wrapMode="none" fg={statusColor(props.api, job.health)}>{selectedIndex() === index() ? "▶" : " "} {statusIcon(job.health)} <span style={{ fg: props.api.theme.current.text }}>{job.name}</span></text>
                  <text wrapMode="none" fg={props.api.theme.current.textMuted}>    {job.scheduleText} · next {relativeTime(job.nextRunAt)} · {job.workdir}</text>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
        <Show when={orphans().length} fallback={null}>
          <box paddingTop={1}>
            <text fg={props.api.theme.current.warning}><b>Orphaned OS tasks ({orphans().length})</b></text>
            <For each={orphans()}>
              {(orphan) => <text selectable={false} fg={props.api.theme.current.warning} onMouseUp={(event) => activateMouse(event, () => openOrphanDialog(props.api, props.store, orphan))}>! {orphan.slug} · {orphan.backend} · click to inspect</text>}
            </For>
          </box>
        </Show>
      </box>
      <text id="scheduler-footer" height={1} flexShrink={0} fg={props.api.theme.current.textMuted}>Mouse: click/scroll · Keyboard: Tab controls · ←/→ select · Enter apply · / search · Esc back</text>
    </box>
  )
}

function perform(api: TuiPluginApi, store: StatusStore, action: () => unknown, success: string) {
  try {
    action()
    api.ui.toast({ variant: "success", title: "Scheduler", message: success })
    void store.refresh()
    return true
  } catch (error) {
    api.ui.toast({ variant: "error", title: "Scheduler", message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

function openScheduleDialog(api: TuiPluginApi, store: StatusStore, job: SchedulerJobStatus) {
  const DialogPrompt = api.ui.DialogPrompt
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title={`Change schedule · ${job.name}`}
      description={() => <text fg={api.theme.current.textMuted}>Five-field cron expression. Current: {job.schedule}</text>}
      value={job.schedule}
      onConfirm={(value) => {
        if (perform(api, store, () => updateSchedulerJobSchedule({ id: job.id }, value), "Schedule updated")) {
          api.ui.dialog.clear()
        }
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

function confirmDelete(api: TuiPluginApi, store: StatusStore, job: SchedulerJobStatus, onDeleted: () => void) {
  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title={`Delete ${job.name}?`}
      message="This removes the job configuration and its OS scheduler entry. Logs are retained."
      onConfirm={() => {
        if (perform(api, store, () => deleteSchedulerJob({ id: job.id }), "Task deleted")) {
          api.ui.dialog.clear()
          onDeleted()
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function confirmMove(
  api: TuiPluginApi,
  store: StatusStore,
  job: SchedulerJobStatus,
  targetWorkdir: string,
  route: Omit<SchedulerRouteParams, "id">,
) {
  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title={`Move ${job.name}?`}
      message={`From: ${job.workdir}\nTo: ${targetWorkdir}\n\nThe operating-system schedule and saved run history will move together.`}
      onConfirm={() => {
        try {
          const moved = moveSchedulerJob({ id: job.id }, targetWorkdir)
          api.ui.toast({ variant: "success", title: "Scheduler", message: "Task moved to current project" })
          api.ui.dialog.clear()
          void store.refresh()
          const movedId = `${moved.scopeId}:${moved.slug}`
          api.route.navigate("scheduler-detail", {
            ...route,
            id: movedId,
            centerState: route.centerState ? { ...route.centerState, selectedId: movedId } : undefined,
          })
        } catch (error) {
          api.ui.toast({ variant: "error", title: "Scheduler", message: error instanceof Error ? error.message : String(error) })
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function openOrphanDialog(api: TuiPluginApi, store: StatusStore, orphan: SchedulerOrphanStatus) {
  const DialogConfirm = api.ui.DialogConfirm
  const ids = orphan.artifactIds.join("\n")
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title={`Remove orphan ${orphan.slug}?`}
      message={`Backend: ${orphan.backend}\nArtifacts:\n${ids}\n\nOnly these exact scheduler artifacts will be removed.`}
      onConfirm={() => {
        if (perform(api, store, () => orphan.artifactIds.forEach((artifactId) => removeOrphanArtifact(artifactId, true)), "Orphan removed")) {
          api.ui.dialog.clear()
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function Action(props: { api: TuiPluginApi; id: string; label: string; onSelect: () => void; warning?: boolean }) {
  return (
    <box
      id={props.id}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.api.theme.current.backgroundElement}
      onMouseUp={(event) => activateMouse(event, props.onSelect)}
    >
      <text selectable={false} fg={props.warning ? props.api.theme.current.warning : props.api.theme.current.primary}>{props.label}</text>
    </box>
  )
}

export function Detail(props: {
  api: TuiPluginApi
  store: StatusStore
  id?: string
  entry?: SchedulerRouteParams["entry"]
  returnRoute?: TuiRouteCurrent
  centerState?: SchedulerCenterState
}): JSX.Element {
  const dimensions = useTerminalDimensions()
  let root: BoxRenderable | undefined
  const job = createMemo(() => props.store.snapshot().jobs.find((item) => item.id === props.id))
  const currentScopeId = createMemo(() => deriveStatusScopeId(props.api.state.path.directory))
  const back = () => {
    if (props.entry === "center") {
      props.api.route.navigate("scheduler", { entry: "command", returnRoute: props.returnRoute, centerState: props.centerState })
      return
    }
    navigateBack(props.api, props.returnRoute)
  }
  createEffect(() => {
    const target = root
    if (!target || props.api.ui.dialog.open) return
    const dispose = props.api.keymap.registerLayer({
      target,
      targetMode: "focus-within",
      priority: 100,
      commands: [
        { name: "scheduler.detail.back", run: back },
        { name: "scheduler.detail.refresh", run: () => void props.store.refresh() },
      ],
      bindings: [
        { key: "escape", cmd: "scheduler.detail.back" },
        { key: "r", cmd: "scheduler.detail.refresh" },
      ],
    })
    onCleanup(dispose)
  })
  onMount(() => {
    root?.focus()
    const focusTimer = setTimeout(() => {
      if (!props.api.ui.dialog.open) root?.focus()
    }, 1)
    onCleanup(() => clearTimeout(focusTimer))
    void props.store.refresh()
  })
  return (
    <box
      id="scheduler-task-detail"
      ref={(element: BoxRenderable) => (root = element)}
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      minHeight={0}
      padding={2}
      flexDirection="column"
      backgroundColor={props.api.theme.current.background}
      focusable
      focused={!props.api.ui.dialog.open}
    >
      <Header api={props.api} title={job()?.name || "Scheduled task"} back={back} health={job()?.health} />
      <Show when={job()} fallback={<text fg={props.api.theme.current.warning}>Task not found. Refresh or return to the task center.</text>}>
        {(item) => (
          <scrollbox flexGrow={1}>
            <box gap={1} paddingRight={1}>
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
              <Show when={item().diagnostics.length} fallback={null}>
                <box border borderColor={props.api.theme.current.warning} padding={1}>
                  <text fg={props.api.theme.current.warning}><b>Diagnostics</b></text>
                  <For each={item().diagnostics}>{(message) => <text fg={props.api.theme.current.warning}>! {message}</text>}</For>
                </box>
              </Show>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <Action id="scheduler-action-run" api={props.api} label="Run now" onSelect={() => perform(props.api, props.store, () => runSchedulerJob({ id: item().id }), "Task started")} />
                <Action
                  id="scheduler-action-toggle"
                  api={props.api}
                  label={item().enabled ? "Pause" : "Resume"}
                  onSelect={() => perform(props.api, props.store, () => item().enabled ? pauseSchedulerJob({ id: item().id }) : resumeSchedulerJob({ id: item().id }), item().enabled ? "Task paused" : "Task resumed")}
                />
                <Action id="scheduler-action-schedule" api={props.api} label="Edit frequency" onSelect={() => openScheduleDialog(props.api, props.store, item())} />
                <Show when={item().scopeId !== currentScopeId()} fallback={null}>
                  <Action id="scheduler-action-move" api={props.api} label="Move to current project" onSelect={() => confirmMove(props.api, props.store, item(), props.api.state.path.directory, {
                    entry: props.entry,
                    returnRoute: props.returnRoute,
                    centerState: props.centerState,
                  })} />
                </Show>
                <Action id="scheduler-action-logs" api={props.api} label="View logs" onSelect={() => openLogs(props.api, item())} />
                <Action id="scheduler-action-delete" api={props.api} label="Delete" warning onSelect={() => confirmDelete(props.api, props.store, item(), back)} />
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
    order: 199,
    slots: {
      sidebar_content() {
        return <Sidebar api={api} store={store} />
      },
    },
  })
  api.route.register([
    {
      name: "scheduler",
      render: ({ params }) => <TaskCenter
        api={api}
        store={store}
        returnRoute={params?.returnRoute as TuiRouteCurrent | undefined}
        initialState={params?.centerState as SchedulerCenterState | undefined}
      />,
    },
    {
      name: "scheduler-detail",
      render: ({ params }) => <Detail
        api={api}
        store={store}
        id={typeof params?.id === "string" ? params.id : undefined}
        entry={params?.entry as SchedulerRouteParams["entry"]}
        returnRoute={params?.returnRoute as TuiRouteCurrent | undefined}
        centerState={params?.centerState as SchedulerCenterState | undefined}
      />,
    },
  ])
  api.command?.register(() => [{
    title: "Open scheduled tasks",
    value: "scheduler.open",
    description: "Browse and manage OS-verified scheduled tasks",
    category: "Scheduler",
    suggested: true,
    slash: { name: "scheduler", aliases: ["schedules", "tasks"] },
    onSelect: () => {
      const returnRoute = api.route.current
      api.ui.dialog.clear()
      api.route.navigate("scheduler", { entry: "command", returnRoute, centerState: { scope: "current", filter: "all" } })
    },
  }])
}

export { id, tui }
export default { id, tui }
