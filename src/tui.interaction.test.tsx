import { describe, expect, test } from "bun:test"
import { MouseEvent as OpenTuiMouseEvent, RGBA } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onMount, Show } from "solid-js"
import { Detail, Sidebar, TaskCenter } from "./tui"
import { deriveStatusScopeId, type SchedulerJobStatus, type SchedulerStatusSnapshot } from "./status"

const CURRENT_DIRECTORY = "/projects/current"
const CURRENT_SCOPE = deriveStatusScopeId(CURRENT_DIRECTORY)

function findRenderable(root: { id?: string; getChildren?: () => unknown[] }, id: string): any {
  if (root.id === id) return root
  for (const child of root.getChildren?.() || []) {
    const found = findRenderable(child as { id?: string; getChildren?: () => unknown[] }, id)
    if (found) return found
  }
}

async function settle(app: Awaited<ReturnType<typeof testRender>>) {
  await new Promise((resolve) => setTimeout(resolve, 40))
  await app.flush()
}

function dispatchMouse(target: any, type: "down" | "up") {
  target.processMouseEvent(new OpenTuiMouseEvent(target, {
    type,
    button: 0,
    x: target.x + 1,
    y: target.y,
    modifiers: { shift: false, alt: false, ctrl: false },
  }))
}

const theme = {
  background: "#101010",
  backgroundElement: "#303030",
  primary: "#55aaff",
  border: "#555555",
  text: "#ffffff",
  textMuted: "#999999",
  success: "#22cc88",
  info: "#55aaff",
  warning: "#ffaa33",
  error: "#ff5555",
}

function job(name: string, index: number): SchedulerJobStatus {
  const slug = name.toLowerCase().replace(/\s+/g, "-")
  return {
    id: `${CURRENT_SCOPE}:${slug}`,
    scopeId: CURRENT_SCOPE,
    slug,
    name,
    enabled: true,
    health: "healthy",
    backend: "launchd",
    schedule: `*/${index + 1} * * * *`,
    scheduleText: `every ${index + 1} minutes`,
    timezone: "UTC",
    nextRunAt: "2026-07-20T10:00:00.000Z",
    workdir: CURRENT_DIRECTORY,
    logPath: `/tmp/${slug}.log`,
    runHistory: [],
    artifacts: [],
    diagnostics: [],
    job: {
      scopeId: CURRENT_SCOPE,
      slug,
      name,
      schedule: `*/${index + 1} * * * *`,
      workdir: CURRENT_DIRECTORY,
      createdAt: "2026-07-20T00:00:00.000Z",
    },
  }
}

async function mountTaskCenter(jobs: SchedulerJobStatus[]) {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
  let refreshes = 0

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const snapshot: SchedulerStatusSnapshot = {
      scannedAt: "2026-07-20T00:00:00.000Z",
      timezone: "UTC",
      jobs,
      orphans: [],
      diagnostics: [],
      summary: { total: jobs.length, healthy: jobs.length, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
    }
    const [status] = createSignal(snapshot)
    const [loading] = createSignal(false)
    const store = { snapshot: status, loading, error: () => undefined, refresh: async () => { refreshes += 1 } }
    const api = {
      keymap,
      state: { path: { directory: CURRENT_DIRECTORY } },
      route: {
        current: { name: "scheduler", params: { returnRoute: { name: "home" } } },
        navigate(name: string, params?: Record<string, unknown>) {
          navigations.push({ name, params })
        },
      },
      theme: { current: theme },
      ui: { toast() {}, dialog: { clear() {} } },
    }
    return <TaskCenter api={api as never} store={store as never} returnRoute={{ name: "home" }} />
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 24 })
  await app.flush()
  return { app, navigations, refreshes: () => refreshes }
}

describe("scheduler task center interaction", () => {
  test("defaults to the list and opens the selected task with keyboard", async () => {
    const mounted = await mountTaskCenter([job("First task", 0), job("Second task", 1)])
    try {
      mounted.app.mockInput.pressArrow("down")
      mounted.app.mockInput.pressEnter()
      expect(mounted.navigations.at(-1)).toEqual({
        name: "scheduler-detail",
        params: {
          id: `${CURRENT_SCOPE}:second-task`,
          entry: "center",
          returnRoute: { name: "home" },
          centerState: { scope: "current", filter: "all", query: "", selectedId: `${CURRENT_SCOPE}:second-task` },
        },
      })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("focuses search with slash, filters, and returns to the list with Tab", async () => {
    const mounted = await mountTaskCenter([job("Daily report", 0), job("Backup task", 1)])
    try {
      const search = findRenderable(mounted.app.renderer.root, "scheduler-search")
      const hitbox = findRenderable(mounted.app.renderer.root, "scheduler-search-hitbox")
      await mounted.app.mockMouse.click(search.x + 2, search.y)
      await mounted.app.flush()
      expect(mounted.app.renderer.currentFocusedRenderable).toBe(search)
      expect(mounted.navigations).toHaveLength(0)

      mounted.app.mockInput.pressTab()
      hitbox.onMouseDown = undefined
      await mounted.app.mockMouse.click(search.x + search.width - 1, search.y)
      await mounted.app.flush()
      expect(mounted.app.renderer.currentFocusedRenderable).toBe(search)
      await mounted.app.mockInput.typeText("backup")
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Backup task")
      expect(mounted.app.captureCharFrame()).not.toContain("Daily report")
      mounted.app.mockInput.pressTab()
      mounted.app.mockInput.pressEnter()
      expect(mounted.navigations.at(-1)?.params?.id).toBe(`${CURRENT_SCOPE}:backup-task`)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("clears search, exits search, and returns to the source route with Escape", async () => {
    const mounted = await mountTaskCenter([job("Daily report", 0), job("Backup task", 1)])
    try {
      mounted.app.mockInput.pressKey("/")
      await mounted.app.mockInput.typeText("backup")
      mounted.app.mockInput.pressEscape()
      await settle(mounted.app)
      expect(mounted.app.captureCharFrame()).toContain("Daily report")
      mounted.app.mockInput.pressEscape()
      await settle(mounted.app)
      mounted.app.mockInput.pressEscape()
      await settle(mounted.app)
      expect(mounted.navigations.at(-1)).toEqual({ name: "home", params: undefined })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("opens the exact task clicked with the mouse", async () => {
    const mounted = await mountTaskCenter([job("First task", 0), job("Mouse task", 1)])
    try {
      const row = findRenderable(mounted.app.renderer.root, `scheduler-job-${CURRENT_SCOPE}:mouse-task`)
      expect(row).toBeDefined()
      await mounted.app.mockMouse.click(row!.x + 2, row!.y)
      expect(mounted.navigations.at(-1)?.params?.id).toBe(`${CURRENT_SCOPE}:mouse-task`)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("scrolls a long task list with the mouse wheel", async () => {
    const mounted = await mountTaskCenter(Array.from({ length: 20 }, (_, index) => job(`Task ${index + 1}`, index)))
    try {
      const list = findRenderable(mounted.app.renderer.root, "scheduler-task-list")
      expect(list).toBeDefined()
      const before = (list as { scrollTop: number }).scrollTop
      await mounted.app.mockMouse.scroll(list!.x + 2, list!.y + 2, "down")
      expect((list as { scrollTop: number }).scrollTop).toBeGreaterThan(before)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("keeps the task list usable in a narrow terminal", async () => {
    const mounted = await mountTaskCenter([job("Narrow terminal task", 0)])
    try {
      mounted.app.resize(48, 16)
      await mounted.app.flush()
      const frame = mounted.app.captureCharFrame()
      expect(frame).toContain("Narrow terminal task")
      mounted.app.mockInput.pressEnter()
      expect(mounted.navigations.at(-1)?.params?.id).toBe(`${CURRENT_SCOPE}:narrow-terminal-task`)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("keeps filters mouse-accessible and refresh available from the keyboard", async () => {
    const healthy = job("Healthy task", 0)
    const paused = { ...job("Paused task", 1), health: "paused" as const, enabled: false }
    const mounted = await mountTaskCenter([healthy, paused])
    try {
      const filter = findRenderable(mounted.app.renderer.root, "scheduler-filter-paused")
      await mounted.app.mockMouse.click(filter.x + 1, filter.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Paused task")
      expect(mounted.app.captureCharFrame()).not.toContain("Healthy task")

      expect(findRenderable(mounted.app.renderer.root, "scheduler-refresh")).toBeUndefined()
      const before = mounted.refreshes()
      mounted.app.mockInput.pressKey("r")
      await mounted.app.flush()
      expect(mounted.refreshes()).toBeGreaterThan(before)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("keeps search, controls, and footer fixed when the result list is empty", async () => {
    const populated = await mountTaskCenter([job("Positioned task", 0)])
    const populatedPositions = Object.fromEntries(
      ["scheduler-search", "scheduler-controls", "scheduler-footer"].map((id) => [
        id,
        findRenderable(populated.app.renderer.root, id).y,
      ]),
    )
    const populatedResultsHeight = findRenderable(populated.app.renderer.root, "scheduler-results").height
    populated.app.renderer.destroy()

    const empty = await mountTaskCenter([])
    try {
      const emptyPositions = Object.fromEntries(
        ["scheduler-search", "scheduler-controls", "scheduler-footer"].map((id) => [
          id,
          findRenderable(empty.app.renderer.root, id).y,
        ]),
      )
      expect(emptyPositions).toEqual(populatedPositions)
      expect(findRenderable(empty.app.renderer.root, "scheduler-results").height).toBe(populatedResultsHeight)
    } finally {
      empty.app.renderer.destroy()
    }
  })

  test("switches between current and all projects with the mouse", async () => {
    const current = job("Current task", 0)
    const external = {
      ...job("External task", 1),
      id: "external-scope:external-task",
      scopeId: "external-scope",
      workdir: "/projects/external",
    }
    const mounted = await mountTaskCenter([current, external])
    try {
      expect(mounted.app.captureCharFrame()).toContain("Current task")
      expect(mounted.app.captureCharFrame()).not.toContain("External task")
      const all = findRenderable(mounted.app.renderer.root, "scheduler-scope-all")
      const allLabel = findRenderable(mounted.app.renderer.root, "scheduler-scope-all-label")
      expect(all.height).toBe(1)
      await mounted.app.mockMouse.pressDown(allLabel.x, allLabel.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).not.toContain("External task")
      await mounted.app.mockMouse.release(allLabel.x, allLabel.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("External task")
      const currentTab = findRenderable(mounted.app.renderer.root, "scheduler-scope-current")
      await mounted.app.mockMouse.click(currentTab.x, currentTab.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).not.toContain("External task")
      all.onMouseUp = undefined
      await mounted.app.mockMouse.click(all.x, all.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("External task")
      expect(mounted.navigations).toHaveLength(0)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("navigates and applies task-center controls with the keyboard", async () => {
    const current = job("Keyboard current", 0)
    const paused = { ...job("Keyboard paused", 1), health: "paused" as const, enabled: false }
    const external = {
      ...job("Keyboard external", 2),
      id: "external-scope:keyboard-external",
      scopeId: "external-scope",
      workdir: "/projects/external",
    }
    const mounted = await mountTaskCenter([current, paused, external])
    try {
      mounted.app.mockInput.pressTab()
      mounted.app.mockInput.pressArrow("left")
      mounted.app.mockInput.pressEnter()
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Keyboard external")

      mounted.app.mockInput.pressKey("l")
      mounted.app.mockInput.pressEnter()
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).not.toContain("Keyboard external")

      mounted.app.mockInput.pressKey("l")
      mounted.app.mockInput.pressKey("l")
      mounted.app.mockInput.pressKey("l")
      mounted.app.mockInput.pressEnter()
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Keyboard paused")
      expect(mounted.app.captureCharFrame()).not.toContain("Keyboard current")

      mounted.app.mockInput.pressTab()
      await mounted.app.mockInput.typeText("paused")
      mounted.app.mockInput.pressTab()
      mounted.app.mockInput.pressEnter()
      expect(mounted.navigations.at(-1)?.params?.id).toBe(`${CURRENT_SCOPE}:keyboard-paused`)
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("sidebar stays scoped to the current project and keeps counters when collapsed", async () => {
    const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
    const values = new Map<string, unknown>()
    let kvWrites = 0
    let updateSnapshot: (() => void) | undefined
    const current = job("Sidebar current", 0)
    const external = {
      ...job("Sidebar external", 1),
      id: "external-scope:sidebar-external",
      scopeId: "external-scope",
      workdir: "/projects/external",
    }
    function Harness() {
      const snapshot: SchedulerStatusSnapshot = {
        scannedAt: "2026-07-20T00:00:00.000Z",
        timezone: "UTC",
        jobs: [current, external],
        orphans: [],
        diagnostics: [],
        summary: { total: 2, healthy: 2, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
      }
      const [status, setStatus] = createSignal(snapshot)
      updateSnapshot = () => setStatus({ ...snapshot, scannedAt: "2026-07-20T00:00:01.000Z" })
      const [loading] = createSignal(false)
      const api = {
        state: { path: { directory: CURRENT_DIRECTORY } },
        route: {
          current: { name: "session", params: { sessionID: "session-1" } },
          navigate(name: string, params?: Record<string, unknown>) { navigations.push({ name, params }) },
        },
        theme: { current: theme },
        kv: {
          get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
          set: (key: string, value: unknown) => { kvWrites += 1; values.set(key, value) },
        },
      }
      const store = { snapshot: status, loading, error: () => undefined, refresh: async () => {}, scheduleRefresh() {} }
      return <Sidebar api={api as never} store={store as never} />
    }
    const app = await testRender(() => <Harness />, { width: 80, height: 16 })
    try {
      await app.flush()
      const expandedFrame = app.captureCharFrame()
      expect(expandedFrame).toContain("Sidebar current")
      expect(expandedFrame).not.toContain("Sidebar external")
      expect(expandedFrame.indexOf("● Active 1")).toBeLessThan(expandedFrame.indexOf("Sidebar current"))
      const toggle = findRenderable(app.renderer.root, "scheduler-sidebar-toggle")
      expect(toggle.height).toBe(1)
      await app.mockMouse.pressDown(toggle.x, toggle.y)
      await app.flush()
      expect(app.captureCharFrame()).toContain("Sidebar current")
      expect(kvWrites).toBe(0)
      await app.mockMouse.release(toggle.x, toggle.y)
      await app.flush()
      expect(app.captureCharFrame()).not.toContain("Sidebar current")
      expect(kvWrites).toBe(1)
      expect(app.captureCharFrame()).toContain("● Active 1 · Ⅱ Paused 0 · × err 0 · → 1")
      expect(app.captureCharFrame()).toContain("→ 1")
      updateSnapshot?.()
      await app.flush()
      expect(app.captureCharFrame()).not.toContain("Sidebar current")

      const toggleLabel = findRenderable(app.renderer.root, "scheduler-sidebar-toggle-label")
      await app.mockMouse.click(toggleLabel.x, toggleLabel.y)
      await app.flush()
      expect(app.captureCharFrame()).toContain("Sidebar current")
      await app.mockMouse.click(toggle.x + toggle.width - 1, toggle.y)
      await app.flush()
      expect(app.captureCharFrame()).not.toContain("Sidebar current")

      const active = findRenderable(app.renderer.root, "scheduler-sidebar-active")
      await app.mockMouse.click(active.x + 1, active.y)
      const paused = findRenderable(app.renderer.root, "scheduler-sidebar-paused")
      expect(paused.fg.equals(RGBA.fromHex(theme.primary))).toBe(true)
      await app.mockMouse.click(paused.x + 1, paused.y)
      const err = findRenderable(app.renderer.root, "scheduler-sidebar-err")
      await app.mockMouse.click(err.x + 1, err.y)
      expect(navigations).toHaveLength(0)
      const arrow = findRenderable(app.renderer.root, "scheduler-sidebar-open")
      const arrowLabel = findRenderable(app.renderer.root, "scheduler-sidebar-open-label")
      expect(arrowLabel.fg.equals(RGBA.fromHex(theme.text))).toBe(true)
      await app.mockMouse.click(arrow.x + 1, arrow.y)
      expect(navigations.at(-1)).toEqual({
        name: "scheduler",
        params: {
          entry: "command",
          returnRoute: { name: "session", params: { sessionID: "session-1" } },
          centerState: { scope: "current", filter: "all" },
        },
      })
    } finally {
      app.renderer.destroy()
    }

    const restored = await testRender(() => <Harness />, { width: 80, height: 16 })
    try {
      await restored.flush()
      expect(restored.captureCharFrame()).not.toContain("Sidebar current")
      expect(restored.captureCharFrame()).toContain("→ 1")
    } finally {
      restored.renderer.destroy()
    }
  })

  test("sidebar arrow totals the visible active, paused, and error counters", async () => {
    const healthy = job("Sidebar healthy", 0)
    const paused = { ...job("Sidebar paused", 1), enabled: false, health: "paused" as const }
    const drifted = { ...job("Sidebar drifted", 2), health: "drifted" as const }
    function Harness() {
      const snapshot: SchedulerStatusSnapshot = {
        scannedAt: "2026-07-20T00:00:00.000Z",
        timezone: "UTC",
        jobs: [healthy, paused, drifted],
        orphans: [{
          id: "launchd:current-orphan",
          health: "orphaned",
          backend: "launchd",
          scopeId: CURRENT_SCOPE,
          slug: "current-orphan",
          artifactIds: ["launchd:current-orphan"],
          artifacts: [],
          diagnostics: [],
        }],
        diagnostics: [],
        summary: { total: 3, healthy: 1, running: 0, paused: 1, disabled: 0, missing: 0, drifted: 1, orphaned: 1, error: 0 },
      }
      const [status] = createSignal(snapshot)
      const [loading] = createSignal(false)
      const api = {
        state: { path: { directory: CURRENT_DIRECTORY } },
        route: { current: { name: "session" }, navigate() {} },
        theme: { current: theme },
        kv: { get: (_key: string, fallback: unknown) => fallback, set() {} },
      }
      const store = { snapshot: status, loading, error: () => undefined, refresh: async () => {}, scheduleRefresh() {} }
      return <Sidebar api={api as never} store={store as never} />
    }

    const app = await testRender(() => <Harness />, { width: 100, height: 16 })
    try {
      await app.flush()
      expect(app.captureCharFrame()).toContain("● Active 2 · Ⅱ Paused 1 · × err 2 · → 5")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders detail as an overlay and returns to the task center with Escape", async () => {
    const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
    const detailJob = job("Detail task", 0)

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const snapshot: SchedulerStatusSnapshot = {
        scannedAt: "2026-07-20T00:00:00.000Z",
        timezone: "UTC",
        jobs: [detailJob],
        orphans: [],
        diagnostics: [],
        summary: { total: 1, healthy: 1, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
      }
      const [status] = createSignal(snapshot)
      const [loading] = createSignal(false)
      const store = { snapshot: status, loading, error: () => undefined, refresh: async () => {} }
      const api = {
        keymap,
        state: { path: { directory: CURRENT_DIRECTORY } },
        route: {
          current: { name: "scheduler-detail", params: { id: detailJob.id, entry: "center", returnRoute: { name: "home" } } },
          navigate(name: string, params?: Record<string, unknown>) { navigations.push({ name, params }) },
        },
        theme: { current: theme },
        ui: { toast() {}, dialog: { clear() {} } },
      }
      return (
        <>
          <Detail api={api as never} store={store as never} id={detailJob.id} entry="center" returnRoute={{ name: "home" }} centerState={{ scope: "current", filter: "paused" }} />
          <input id="scheduler-dialog-focus-probe" value="" />
        </>
      )
    }

    const app = await testRender(() => <Harness />, { width: 100, height: 30 })
    try {
      await app.flush()
      const root = findRenderable(app.renderer.root, "scheduler-task-detail")
      expect(root).toBeDefined()
      expect(root.zIndex).toBe(2500)
      const title = findRenderable(app.renderer.root, "scheduler-header-title")
      const health = findRenderable(app.renderer.root, "scheduler-header-health")
      expect(title.y).toBe(health.y)
      expect(title.x).toBeLessThan(health.x)
      expect(findRenderable(app.renderer.root, "scheduler-detail-refresh")).toBeUndefined()

      const dialogProbe = findRenderable(app.renderer.root, "scheduler-dialog-focus-probe")
      dialogProbe.focus()
      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations).toHaveLength(0)

      root.focus()
      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations.at(-1)).toEqual({
        name: "scheduler",
        params: { entry: "command", returnRoute: { name: "home" }, centerState: { scope: "current", filter: "paused" } },
      })
    } finally {
      app.renderer.destroy()
    }
  })

  test("opens detail dialogs only after mouse release and keeps them modal", async () => {
    const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
    const toasts: Array<{ variant?: string; message?: string }> = []
    const detailJob = job("Modal task", 0)
    let promptProps: any
    let clearCount = 0
    let closeDialog: (() => void) | undefined

    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const snapshot: SchedulerStatusSnapshot = {
        scannedAt: "2026-07-20T00:00:00.000Z",
        timezone: "UTC",
        jobs: [detailJob],
        orphans: [],
        diagnostics: [],
        summary: { total: 1, healthy: 1, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
      }
      const [status] = createSignal(snapshot)
      const [loading] = createSignal(false)
      const [dialogView, setDialogView] = createSignal<(() => any)>()
      const store = { snapshot: status, loading, error: () => undefined, refresh: async () => {} }
      const dialog = {
        replace(render: () => any) { setDialogView(() => render) },
        clear() { clearCount += 1; setDialogView(undefined) },
        get open() { return Boolean(dialogView()) },
      }
      closeDialog = () => dialog.clear()
      function DialogPrompt(props: any) {
        let input: any
        promptProps = props
        onMount(() => input?.focus())
        return <input id="scheduler-test-dialog-input" ref={(element: any) => (input = element)} value={props.value || ""} />
      }
      function DialogConfirm(props: any) {
        return <text id="scheduler-test-dialog-confirm">{props.title}</text>
      }
      const api = {
        keymap,
        state: { path: { directory: CURRENT_DIRECTORY } },
        route: {
          current: { name: "scheduler-detail" },
          navigate(name: string, params?: Record<string, unknown>) { navigations.push({ name, params }) },
        },
        theme: { current: theme },
        ui: {
          toast(input: { variant?: string; message?: string }) { toasts.push(input) },
          DialogPrompt,
          DialogConfirm,
          dialog,
        },
      }
      return (
        <>
          <Detail api={api as never} store={store as never} id={detailJob.id} entry="sidebar" returnRoute={{ name: "home" }} />
          <Show when={dialogView()}>
            {(render) => (
              <box id="scheduler-test-dialog-backdrop" position="absolute" zIndex={3000} width="100%" height="100%" onMouseUp={() => dialog.clear()}>
                <box onMouseUp={(event) => event.stopPropagation()}>{render()()}</box>
              </box>
            )}
          </Show>
        </>
      )
    }

    const app = await testRender(() => <Harness />, { width: 100, height: 50 })
    try {
      await app.flush()
      const edit = findRenderable(app.renderer.root, "scheduler-action-schedule")
      dispatchMouse(edit, "down")
      await app.flush()
      expect(findRenderable(app.renderer.root, "scheduler-test-dialog-input")).toBeUndefined()

      dispatchMouse(edit, "up")
      await settle(app)
      const dialogInput = findRenderable(app.renderer.root, "scheduler-test-dialog-input")
      expect(dialogInput).toBeDefined()
      expect(app.renderer.currentFocusedRenderable).toBe(dialogInput)
      expect(clearCount).toBe(0)

      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations).toHaveLength(0)
      expect(findRenderable(app.renderer.root, "scheduler-test-dialog-input")).toBeDefined()

      promptProps.onConfirm("not a cron expression")
      await app.flush()
      expect(toasts.at(-1)?.variant).toBe("error")
      expect(clearCount).toBe(0)
      expect(findRenderable(app.renderer.root, "scheduler-test-dialog-input")).toBeDefined()

      closeDialog?.()
      await app.flush()
      const remove = findRenderable(app.renderer.root, "scheduler-action-delete")
      await app.mockMouse.click(remove.x + 1, remove.y)
      await app.flush()
      expect(findRenderable(app.renderer.root, "scheduler-test-dialog-confirm")).toBeDefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("returns directly to the OpenCode route when detail was opened from the sidebar", async () => {
    const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
    const detailJob = job("Direct detail", 0)
    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      const snapshot: SchedulerStatusSnapshot = {
        scannedAt: "2026-07-20T00:00:00.000Z",
        timezone: "UTC",
        jobs: [detailJob],
        orphans: [],
        diagnostics: [],
        summary: { total: 1, healthy: 1, running: 0, paused: 0, disabled: 0, missing: 0, drifted: 0, orphaned: 0, error: 0 },
      }
      const [status] = createSignal(snapshot)
      const [loading] = createSignal(false)
      const api = {
        keymap,
        state: { path: { directory: CURRENT_DIRECTORY } },
        route: {
          current: { name: "scheduler-detail" },
          navigate(name: string, params?: Record<string, unknown>) { navigations.push({ name, params }) },
        },
        theme: { current: theme },
        ui: { toast() {}, dialog: { clear() {} } },
      }
      const store = { snapshot: status, loading, error: () => undefined, refresh: async () => {} }
      return <Detail api={api as never} store={store as never} id={detailJob.id} entry="sidebar" returnRoute={{ name: "session", params: { sessionID: "session-1" } }} />
    }
    const app = await testRender(() => <Harness />, { width: 100, height: 30 })
    try {
      await app.flush()
      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations.at(-1)).toEqual({ name: "session", params: { sessionID: "session-1" } })
    } finally {
      app.renderer.destroy()
    }
  })
})
