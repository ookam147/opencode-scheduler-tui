import { describe, expect, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"
import plugin from "./tui.js"

type Layer = ReturnType<Parameters<Plugin.Context["keymap"]["layer"]>[0]>
type Claim = { append: string; render(input: { sessionID: string }): unknown }

function host(route: { type: string; sessionID?: string }, saved: Record<string, unknown> = {}) {
  const selects: { title: string; options: { title: string; value: unknown; footer?: string }[]; current?: unknown }[] = []
  const answers: unknown[] = []
  const writes: unknown[] = []
  const layers: Layer[] = []
  const toasts: unknown[] = []
  const navigation: unknown[] = []
  const deletions: string[] = []
  const confirmations: unknown[] = []
  const reads: unknown[] = []
  const state: { slot?: Claim; released: boolean; signal?: AbortSignal; finishPause?: () => void; confirmDelete: boolean } = { released: false, confirmDelete: false }
  const white = "#ffffff"
  const context = {
    client: {
      experimental: { automation: { list: async (input: unknown, options: { signal: AbortSignal }) => {
        reads.push(input); state.signal = options.signal
        return [{ id: "aut_test", sessionID: "ses_test", name: "原生提醒", action: { type: "prompt", prompt: "提醒喝水", to: { session: "ses_test" } }, trigger: { type: "at", at: "in 5 minutes" }, tz: "Asia/Shanghai", directory: "/work", status: "active", runCount: 0, time: { created: 0, updated: 0 } }]
      }, pause: async () => {
        await new Promise<void>((resolve) => { state.finishPause = resolve })
        return { id: "aut_test", action: { type: "prompt", prompt: "提醒喝水", to: { session: "ses_test" } }, trigger: { type: "at", at: "in 5 minutes" }, tz: "UTC", directory: "/work", status: "paused", runCount: 0 }
      }, delete: async ({ automationID }: { automationID: string }) => { deletions.push(automationID) } } },
    },
    data: { session: { get: (id: string) => id === "ses_test" ? { id, title: "会话标题" } : undefined } },
    keymap: { layer: (factory: () => Layer) => { layers.push(factory()) } },
    renderer: { currentFocusedRenderable: null, root: { on() {}, off() {} } },
    ui: {
      slot: (claim: Claim) => { state.slot = claim; return () => { state.released = true } },
      router: { current: () => route, navigate: (value: unknown) => { navigation.push(value) } },
      dialog: { clear() {}, confirm: async (value: unknown) => { confirmations.push(value); return state.confirmDelete },
        select: async (value: (typeof selects)[number]) => { selects.push(value); return answers.shift() } },
      toast: { show: (value: unknown) => { toasts.push(value) } },
    },
    storage: { store: (_key: string, options: { initial: object }) => {
      const [store, set] = createStore({ ...options.initial, ...saved })
      return [store, async (mutation: (draft: object) => void) => { set(produce(mutation)); writes.push({ ...store }) }]
    } },
    theme: { text: { base: white, muted: white, faint: white, action: { primary: { selected: white } }, feedback: { success: { base: white }, warning: { base: white }, error: { base: white }, info: { base: white } } }, background: { base: "#101010", raised: { high: "#333333" } }, border: { base: white } },
  } as unknown as Plugin.Context
  return { context, layers, toasts, navigation, reads, state, deletions, confirmations, selects, answers, writes }
}

const settle = async (app: { flush(): Promise<void> | void }) => { await new Promise((resolve) => setTimeout(resolve, 20)); await app.flush() }

describe("V2 native TUI host integration", () => {
  test("uses English commands and confirmation dialogs when English is the saved language", async () => {
    const h = host({ type: "session", sessionID: "ses_test" }, { language: "en" })
    const cleanup = await plugin.setup(h.context)
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
    try {
      const command = h.layers[0]!.commands![0]!
      expect(command.title).toBe("Show or hide automations")
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
      // The owning session's title comes from the host's cache, not a request.
      expect(h.confirmations[0]).toMatchObject({ message: expect.stringContaining("会话标题") })
      expect(h.deletions).toEqual([])
      h.state.confirmDelete = true
      await remove.run()
      await settle(app)
      expect(h.deletions).toEqual(["aut_test"])
      expect(h.navigation).toEqual([])
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
  })
  test.each([false, true])("automatic polling is silent, non-overlapping and preserves the visible frame (empty=%s)", async (empty) => {
    const h = host({ type: "session", sessionID: "ses_test" })
    if (empty) {
      const list = h.context.client.experimental.automation.list
      h.context.client.experimental.automation.list = async (...args) => { await list(...args); return [] }
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
      const originalList = h.context.client.experimental.automation.list
      h.context.client.experimental.automation.list = async (...args) => {
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
    expect(command.slash).toEqual({ name: "automation_status" })
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 110, height: 30 })
    try {
      await settle(app)
      expect(app.captureCharFrame()).not.toContain("Automations")
      await command.run()
      await settle(app)
      // One unfiltered request; no per-session fan-out.
      expect(h.reads).toEqual([undefined])
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
      expect(h.reads).toEqual([undefined])
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
    expect(h.state.released).toBe(true)
  })

  test("defaults to Chinese whatever the machine time zone is", async () => {
    const h = host({ type: "session", sessionID: "ses_test" })
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    const zone = spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function () {
      return { ...original.call(this), timeZone: "America/New_York" }
    })
    try { await plugin.setup(h.context) } finally { zone.mockRestore() }
    expect(h.layers[0]!.commands![0]!.title).toBe("自动化任务")
  })
  test("the settings command saves a choice and switches the open window's language", async () => {
    const h = host({ type: "session", sessionID: "ses_test" })
    const cleanup = await plugin.setup(h.context)
    const settings = h.layers[0]!.commands!.find((item) => item.id === "scheduler.automation_settings")!
    expect(settings.title).toBe("自动化任务设置")
    const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
    try {
      await h.layers[0]!.commands![0]!.run()
      await settle(app)
      expect(app.captureCharFrame()).toContain("当前会话")
      // Pick "language", then "English", then leave the settings list.
      h.answers.push("language", "en", undefined)
      await settings.run()
      await settle(app)
      expect(h.selects[0]!.title).toBe("Automations 设置")
      expect(h.selects[0]!.options.map((item) => item.title)).toEqual(["界面语言", "自动刷新", "排序方式", "时间显示", "默认范围", "默认状态"])
      expect(h.selects[0]!.options.map((item) => item.footer)).toEqual(["简体中文", "每 5 秒", "创建时间（最早在前）", "相对时间（如 3 分钟后）", "当前会话", "全部"])
      expect(h.selects[1]!.options.map((item) => item.title)).toEqual(["简体中文", "English"])
      expect(h.writes).toEqual([expect.objectContaining({ language: "en" })])
      // The list reopens in the new language, on the setting just changed.
      expect(h.selects[2]!.title).toBe("Automations settings")
      expect(h.selects[2]!.current).toBe("language")
      expect(app.captureCharFrame()).toContain("Current session")
    } finally { app.renderer.destroy(); if (typeof cleanup === "function") await cleanup() }
  })
  test("the refresh setting sets the poll interval, and off stops polling", async () => {
    const delays: number[] = []
    const originalInterval = globalThis.setInterval
    const timer = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
      delays.push(delay)
      return originalInterval(callback, delay)
    }) as typeof setInterval)
    try {
      // The window's own 30-second clock is not a poll.
      for (const [refresh, expected] of [[60, [60_000]], [0, []]] as const) {
        delays.length = 0
        const h = host({ type: "session", sessionID: "ses_test" }, { refresh })
        await plugin.setup(h.context)
        const app = await testRender(() => h.state.slot!.render({ sessionID: "ses_test" }) as never, { width: 120, height: 30 })
        try {
          await h.layers[0]!.commands![0]!.run()
          await settle(app)
          expect(delays.filter((delay) => delay !== 30_000)).toEqual([...expected])
        } finally { app.renderer.destroy() }
      }
    } finally { timer.mockRestore() }
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
