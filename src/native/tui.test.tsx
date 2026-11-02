import { describe, expect, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import plugin from "./tui.js"

type Layer = ReturnType<Parameters<Plugin.Context["keymap"]["layer"]>[0]>
type Claim = { append: string; render(input: { sessionID: string }): unknown }

function host(route: { type: string; sessionID?: string }) {
  const layers: Layer[] = []
  const toasts: unknown[] = []
  const navigation: unknown[] = []
  const deletions: string[] = []
  const confirmations: unknown[] = []
  const reads: string[] = []
  const state: { slot?: Claim; released: boolean; signal?: AbortSignal; finishPause?: () => void; confirmDelete: boolean } = { released: false, confirmDelete: false }
  const white = "#ffffff"
  const context = {
    client: {
      experimental: { schedule: { list: async (input: { sessionID: string }, options: { signal: AbortSignal }) => {
        reads.push(input.sessionID); state.signal = options.signal
        return [{ id: "sch_test", sessionID: "ses_test", name: "原生提醒", action: { type: "prompt", prompt: "提醒喝水" }, when: { type: "in", in: "5 minutes" }, tz: "Asia/Shanghai", status: "active", runCount: 0, time: { created: 0, updated: 0 } }]
      }, pause: async () => {
        await new Promise<void>((resolve) => { state.finishPause = resolve })
        return { id: "sch_test", action: { type: "prompt", prompt: "提醒喝水" }, when: { type: "in", in: "5 minutes" }, tz: "UTC", status: "paused", runCount: 0 }
      }, delete: async ({ scheduleID }: { scheduleID: string }) => { deletions.push(scheduleID) } } },
      session: { get: async () => ({ id: "ses_test", title: "当前会话", location: { directory: "/work" } }) },
    },
    keymap: { layer: (factory: () => Layer) => { layers.push(factory()) } },
    renderer: { currentFocusedRenderable: null, root: { on() {}, off() {} } },
    ui: {
      slot: (claim: Claim) => { state.slot = claim; return () => { state.released = true } },
      router: { current: () => route, navigate: (value: unknown) => { navigation.push(value) } },
      dialog: { clear() {}, confirm: async (value: unknown) => { confirmations.push(value); return state.confirmDelete } },
      toast: { show: (value: unknown) => { toasts.push(value) } },
    },
    theme: { text: { base: white, muted: white, faint: white, action: { primary: { selected: white } }, feedback: { success: { base: white }, warning: { base: white }, error: { base: white }, info: { base: white } } }, background: { base: "#101010", raised: { high: "#333333" } }, border: { base: white } },
  } as unknown as Plugin.Context
  return { context, layers, toasts, navigation, reads, state, deletions, confirmations }
}

const settle = async (app: { flush(): Promise<void> | void }) => { await new Promise((resolve) => setTimeout(resolve, 20)); await app.flush() }

describe("V2 native TUI host integration", () => {
  test("uses English commands and confirmation dialogs for an English-selected time zone", async () => {
    const h = host({ type: "session", sessionID: "ses_test" })
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    const zone = spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function () {
      return { ...original.call(this), timeZone: "America/New_York" }
    })
    let cleanup: Awaited<ReturnType<typeof plugin.setup>>
    try { cleanup = await plugin.setup(h.context) } finally { zone.mockRestore() }
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
    try {
      const command = h.layers[0]!.commands![0]!
      expect(command.title).toBe("Show or hide scheduled tasks")
      await command.run()
      await settle(app)
      expect(app.captureCharFrame()).toContain("Current session")
      await h.layers.at(-1)!.commands!.find((item) => item.bind === "d")!.run()
      await settle(app)
      expect(h.confirmations[0]).toMatchObject({ label: { confirm: "Delete", cancel: "Cancel" } })
      expect(h.deletions).toEqual([])
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
  })
  test("d deletes only after confirmation through the native API", async () => {
    const h = host({ type: "session", sessionID: "ses_test" })
    const cleanup = await plugin.setup(h.context)
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
    try {
      await h.layers[0]!.commands![0]!.run()
      await settle(app)
      const remove = h.layers.at(-1)!.commands!.find((item) => item.bind === "d")!
      await remove.run()
      await settle(app)
      expect(h.confirmations).toHaveLength(1)
      expect(h.deletions).toEqual([])
      h.state.confirmDelete = true
      await remove.run()
      await settle(app)
      expect(h.deletions).toEqual(["sch_test"])
      expect(h.navigation).toEqual([])
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
  })
  test.each([false, true])("automatic polling is silent, non-overlapping and preserves the visible frame (empty=%s)", async (empty) => {
    const h = host({ type: "session", sessionID: "ses_test" })
    if (empty) {
      const list = h.context.client.experimental.schedule.list
      h.context.client.experimental.schedule.list = async (...args) => { await list(...args); return [] }
    }
    let poll: (() => void) | undefined
    const originalInterval = globalThis.setInterval
    const timer = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
      if (delay === 5_000) poll = callback
      return originalInterval(callback, delay)
    }) as typeof setInterval)
    const cleanup = await plugin.setup(h.context)
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
    let finish: (() => void) | undefined
    try {
      await h.layers[0]!.commands![0]!.run()
      await settle(app)
      const before = app.captureCharFrame()
      const originalList = h.context.client.experimental.schedule.list
      h.context.client.experimental.schedule.list = async (...args) => {
        await new Promise<void>((resolve) => { finish = resolve })
        return originalList(...args)
      }
      expect(poll).toBeDefined()
      poll!()
      await settle(app)
      expect(finish).toBeDefined()
      expect(app.captureCharFrame()).toBe(before)
      const firstFinish = finish
      finish = undefined
      poll!()
      await settle(app)
      expect(finish).toBeUndefined()
      firstFinish!()
      await settle(app)
      expect(h.reads).toHaveLength(2)
      expect(app.captureCharFrame()).toBe(before)
    } finally {
      timer.mockRestore()
      app.renderer.destroy()
      if (typeof cleanup === "function") await cleanup()
    }
  })
  test("opens above the message box, delegates keys, and closes without stray requests", async () => {
    const h = host({ type: "session", sessionID: "ses_test" })
    const cleanup = await plugin.setup(h.context)
    expect(h.state.slot?.append).toBe("session.composer.top")
    const command = h.layers[0]!.commands![0]!
    expect(command.slash).toEqual({ name: "schedule_status" })
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 110, height: 30 })
    try {
      await settle(app)
      expect(app.captureCharFrame()).not.toContain("Schedules")
      await command.run()
      await settle(app)
      expect(h.reads).toEqual(["ses_test"])
      expect(app.captureCharFrame()).toContain("原生提醒")
      expect(app.captureCharFrame()).not.toContain("新建")
      const keys = h.layers.at(-1)!.commands!
      expect(keys.some((item) => item.bind === "n")).toBe(false)
      await keys.find((item) => item.bind === "p")!.run()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(h.state.finishPause).toBeDefined()
      await keys.find((item) => item.bind === "escape")!.run()
      await settle(app)
      expect(app.captureCharFrame()).not.toContain("原生提醒")
      expect(h.state.signal?.aborted).toBe(true)
      h.state.finishPause?.()
      await settle(app)
      expect(h.reads).toEqual(["ses_test"])
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
    expect(h.state.released).toBe(true)
  })

  test("asks for a session instead of opening at Home", async () => {
    const h = host({ type: "home" })
    await plugin.setup(h.context)
    await h.layers[0]!.commands![0]!.run()
    expect(h.toasts).toHaveLength(1)
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 80, height: 20 })
    try {
      await settle(app)
      expect(h.reads).toEqual([])
    } finally { app.renderer.destroy() }
  })
})
