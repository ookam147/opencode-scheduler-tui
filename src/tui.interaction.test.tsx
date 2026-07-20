import { describe, expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { Detail, TaskCenter } from "./tui"
import type { SchedulerJobStatus, SchedulerStatusSnapshot } from "./status"

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
}

function job(name: string, index: number): SchedulerJobStatus {
  const slug = name.toLowerCase().replace(/\s+/g, "-")
  return {
    id: `scope:${slug}`,
    scopeId: "scope",
    slug,
    name,
    enabled: true,
    health: "healthy",
    backend: "launchd",
    schedule: `*/${index + 1} * * * *`,
    scheduleText: `every ${index + 1} minutes`,
    timezone: "UTC",
    nextRunAt: "2026-07-20T10:00:00.000Z",
    workdir: "/projects/current",
    logPath: `/tmp/${slug}.log`,
    runHistory: [],
    artifacts: [],
    diagnostics: [],
    job: {
      scopeId: "scope",
      slug,
      name,
      schedule: `*/${index + 1} * * * *`,
      workdir: "/projects/current",
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
      state: { path: { directory: "/projects/current" } },
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
        params: { id: "scope:second-task", returnRoute: { name: "home" } },
      })
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("focuses search with slash, filters, and returns to the list with Tab", async () => {
    const mounted = await mountTaskCenter([job("Daily report", 0), job("Backup task", 1)])
    try {
      mounted.app.mockInput.pressKey("/")
      await mounted.app.mockInput.typeText("backup")
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Backup task")
      expect(mounted.app.captureCharFrame()).not.toContain("Daily report")
      mounted.app.mockInput.pressTab()
      mounted.app.mockInput.pressEnter()
      expect(mounted.navigations.at(-1)?.params?.id).toBe("scope:backup-task")
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
      const row = findRenderable(mounted.app.renderer.root, "scheduler-job-scope:mouse-task")
      expect(row).toBeDefined()
      await mounted.app.mockMouse.click(row!.x + 2, row!.y)
      expect(mounted.navigations.at(-1)?.params?.id).toBe("scope:mouse-task")
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
      expect(mounted.navigations.at(-1)?.params?.id).toBe("scope:narrow-terminal-task")
    } finally {
      mounted.app.renderer.destroy()
    }
  })

  test("keeps filters and refresh mouse-accessible", async () => {
    const healthy = job("Healthy task", 0)
    const paused = { ...job("Paused task", 1), health: "paused" as const, enabled: false }
    const mounted = await mountTaskCenter([healthy, paused])
    try {
      const filter = findRenderable(mounted.app.renderer.root, "scheduler-filter-paused")
      await mounted.app.mockMouse.click(filter.x + 1, filter.y)
      await mounted.app.flush()
      expect(mounted.app.captureCharFrame()).toContain("Paused task")
      expect(mounted.app.captureCharFrame()).not.toContain("Healthy task")

      const refresh = findRenderable(mounted.app.renderer.root, "scheduler-refresh")
      const before = mounted.refreshes()
      await mounted.app.mockMouse.click(refresh.x, refresh.y)
      expect(mounted.refreshes()).toBeGreaterThan(before)
    } finally {
      mounted.app.renderer.destroy()
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
        route: {
          current: { name: "scheduler-detail", params: { id: detailJob.id, returnRoute: { name: "home" } } },
          navigate(name: string, params?: Record<string, unknown>) { navigations.push({ name, params }) },
        },
        theme: { current: theme },
        ui: { toast() {}, dialog: { clear() {} } },
      }
      return (
        <>
          <Detail api={api as never} store={store as never} id={detailJob.id} returnRoute={{ name: "home" }} />
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

      const dialogProbe = findRenderable(app.renderer.root, "scheduler-dialog-focus-probe")
      dialogProbe.focus()
      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations).toHaveLength(0)

      root.focus()
      app.mockInput.pressEscape()
      await settle(app)
      expect(navigations.at(-1)).toEqual({ name: "scheduler", params: { returnRoute: { name: "home" } } })
    } finally {
      app.renderer.destroy()
    }
  })
})
