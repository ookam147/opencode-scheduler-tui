import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { AutomationRow } from "./model"
import type { Language } from "./i18n"
import { columns } from "./format"
import { reconcileWindowSelection, AutomationWindow, type AutomationWindowTheme } from "./window"

const theme: AutomationWindowTheme = {
  text: "#ffffff", muted: "#999999", accent: "#55aaff", background: "#101010",
  raised: "#303030", border: "#555555", success: "#22cc88", warning: "#ffaa33", error: "#ff5555", info: "#55aaff",
}
function row(id: string, status: AutomationRow["status"] = "active", sessionID = "session-1"): AutomationRow {
  return { id, name: `Task ${id}`, action: { type: "prompt", prompt: `Prompt for ${id}`, to: { session: sessionID } },
    trigger: { type: "every", every: "1h" }, tz: "UTC", directory: "/work", status, sessionID, runCount: 3, lastOutcome: "fired" }
}
async function mount(rows: AutomationRow[], width = 110, height = 26, language: Language = "zh") {
  const [items, setItems] = createSignal(rows)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const calls: string[] = []
  const app = await testRender(() => <AutomationWindow language={() => language} rows={items} loading={loading} error={error}
    currentSessionID={() => "session-1"} theme={() => theme}
    refresh={() => { calls.push("refresh") }} pause={(row) => { calls.push(`pause:${row.id}`) }}
    resume={(row) => { calls.push(`resume:${row.id}`) }} remove={(row) => { calls.push(`remove:${row.id}`); setItems(items().filter((item) => item.id !== row.id)) }}
    openSession={(row) => { calls.push(`open:${row.id}`) }} close={() => { calls.push("close") }}
  />, { width, height })
  await app.flush()
  async function key(value: string) {
    if (value === "right" || value === "left") app.mockInput.pressArrow(value)
    else if (value === "tab") app.mockInput.pressTab()
    else if (value === "escape") app.mockInput.pressEscape()
    else app.mockInput.pressKey(value)
    await new Promise((resolve) => setTimeout(resolve, 35))
    await app.flush()
  }
  return { app, calls, setItems, setLoading, setError, key }
}

describe("automation window", () => {
  test.each(["zh", "en"] as const)("explains a shell action and its last output (%s)", async (language) => {
    const shell: AutomationRow = { ...row("shell"), name: "Health check",
      action: { type: "shell", command: "curl -sf https://example.com/health" },
      lastOutcome: "failed", lastRunAt: Date.now() - 60_000, lastOutput: "Exit code: 22\ncurl: (22) 503" }
    const m = await mount([shell], 150, 44, language)
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("curl -sf https://example.com/health")
      expect(frame).toContain(language === "zh" ? "Shell 命令" : "Shell command")
      expect(frame).toContain("curl: (22) 503")
      expect(frame).toContain(language === "zh" ? "上次输出" : "Last output")
      if (language === "en") expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
    } finally { m.app.renderer.destroy() }
  })
  test.each(["zh", "en"] as const)("says whether a code run woke an agent and shows its saved state (%s)", async (language) => {
    const code: AutomationRow = { ...row("code"), name: "Order watch",
      action: { type: "code", code: "return orders.length ? { send: { prompt: 'x' } } : undefined" },
      lastOutcome: "fired", lastRunAt: Date.now() - 60_000, lastOutput: "Prompted ses_abc", state: { lastOrder: 1042 } }
    const m = await mount([code], 150, 50, language)
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain(language === "zh" ? "已唤醒 AI" : "woke an agent")
      expect(frame).toContain(language === "zh" ? "保存的状态" : "Saved state")
      expect(frame).toContain('"lastOrder": 1042')
      expect(frame).not.toContain(language === "zh" ? "无网络访问" : "no network access")
      if (language === "en") expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
    } finally { m.app.renderer.destroy() }
  })
  test.each(["zh", "en"] as const)("tags only unfinished rows whose last run failed (%s)", async (language) => {
    const failing: AutomationRow = { ...row("failing"), name: "Fail task", lastOutcome: "failed" }
    const paused: AutomationRow = { ...row("paused", "paused"), name: "Paused task", lastOutcome: "failed" }
    const finished: AutomationRow = { ...row("finished", "done"), name: "Done task", lastOutcome: "failed" }
    const fine: AutomationRow = { ...row("fine"), name: "Fine task" }
    const m = await mount([failing, paused, finished, fine], 150, 30, language)
    try {
      const lines = m.app.captureCharFrame().split("\n")
      const tag = language === "zh" ? "失败" : "failed"
      const plan = language === "zh" ? "每隔 1h" : "Every 1h"
      const line = (name: string) => lines.find((item) => item.includes(name) && item.includes(plan))!
      expect(line("Fail task")).toContain(`Fail task ${tag}`)
      expect(line("Paused task")).toContain(`Paused task ${tag}`)
      for (const name of ["Done task", "Fine task"]) expect(line(name)).not.toContain(` ${tag}`)
      const column = (text: string) => columns(text.slice(0, text.indexOf(plan)))
      expect(column(line("Fail task"))).toBe(column(line("Fine task")))
    } finally { m.app.renderer.destroy() }
  })
  test("marks code, shell and subagent actions in the list without shifting columns", async () => {
    const plain = row("plain")
    const coded: AutomationRow = { ...row("coded"), name: "Inbox watch",
      action: { type: "code", code: "const t = await tools.slack.read_thread({ id })\nreturn t.count > 0" } }
    const child: AutomationRow = { ...row("child"), name: "Triage run", action: { type: "prompt", prompt: "triage", to: { subagent: "explore" } } }
    const m = await mount([plain, coded, child], 150, 44, "zh")
    try {
      const lines = m.app.captureCharFrame().split("\n")
      const plainRow = lines.find((line) => line.includes("● Task plain"))!
      const codedRow = lines.find((line) => line.includes("Inbox watch") && line.includes("每隔 1h"))!
      const childRow = lines.find((line) => line.includes("Triage run") && line.includes("每隔 1h"))!
      expect(codedRow).toContain("λ")
      expect(childRow).toContain("↳")
      expect(plainRow).not.toContain("λ")
      const column = (line: string) => columns(line.slice(0, line.indexOf("每隔 1h")))
      expect(column(codedRow)).toBe(column(plainRow))
      expect(column(childRow)).toBe(column(plainRow))
      await m.key("down")
      let frame = m.app.captureCharFrame()
      expect(frame).toContain("Code Mode 脚本")
      expect(frame).toContain("tools.slack.read_thread")
      // Explanations live in help, not among the task's own content.
      expect(frame).not.toContain("不调用 AI")
      await m.key("down")
      frame = m.app.captureCharFrame()
      // A subagent run names its own action kind and where it goes.
      expect(frame).toMatch(/动作\s+子代理 explore/)
      expect(frame).not.toContain("发送到")
    } finally { m.app.renderer.destroy() }
  })
  test.each(["zh", "en"] as const)("h swaps the details for help and back; esc leaves help before closing (%s)", async (language) => {
    const m = await mount([row("a")], 150, 44, language)
    try {
      const help = language === "zh" ? "列表标记" : "List markers"
      expect(m.app.captureCharFrame()).not.toContain(help)
      expect(m.app.captureCharFrame()).toContain(language === "zh" ? "h 帮助" : "h Help")
      await m.key("h")
      let frame = m.app.captureCharFrame()
      expect(frame).toContain(help)
      expect(frame).toContain(language === "zh" ? "原会话收不到消息" : "the original session gets no message")
      expect(frame).not.toContain("Prompt for a")
      if (language === "en") expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
      await m.key("escape")
      frame = m.app.captureCharFrame()
      expect(frame).not.toContain(help)
      expect(frame).toContain("Prompt for a")
      expect(m.calls).not.toContain("close")
      await m.key("h"); await m.key("h")
      expect(m.app.captureCharFrame()).not.toContain(help)
    } finally { m.app.renderer.destroy() }
  })
  test("an event watch shows its server, event and arguments", async () => {
    const watch: AutomationRow = { ...row("watch"), name: "Push watch", nextDueAt: undefined,
      trigger: { type: "event", server: "github", event: "push", args: { repo: "a/b" } } }
    const m = await mount([watch], 150, 40, "en")
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("Event github/push")
      expect(frame).toContain('{"repo":"a/b"}')
      expect(frame).toContain("On each event")
    } finally { m.app.renderer.destroy() }
  })
  test("a one-time trigger stored as a UTC instant is shown on the local clock", async () => {
    const due = new Date(Date.now() + 2 * 86_400_000)
    due.setHours(9, 5, 0, 0)
    const once: AutomationRow = { ...row("once"), trigger: { type: "at", at: due.toISOString() } }
    const m = await mount([once], 150, 30, "en")
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("09:05")
      expect(frame).not.toContain(due.toISOString())
    } finally { m.app.renderer.destroy() }
  })
  test("current scope includes automations created elsewhere that prompt this session", async () => {
    const inbound: AutomationRow = { ...row("inbound", "active", "session-2"), name: "Inbound",
      action: { type: "prompt", prompt: "hi", to: { session: "session-1" } }, target: { id: "session-1", title: "Here" } }
    const elsewhere = row("elsewhere", "active", "session-2")
    const m = await mount([inbound, elsewhere], 150, 30, "en")
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("Inbound")
      expect(frame).not.toContain("Task elsewhere")
      expect(frame).toMatch(/Sends to\s+Here/)
    } finally { m.app.renderer.destroy() }
  })
  test("the English next column fits a full relative time without truncation", async () => {
    const soon: AutomationRow = { ...row("soon"), nextDueAt: Date.now() + 58 * 60_000 + 20_000 }
    const m = await mount([soon], 150, 20, "en")
    try {
      const listRow = m.app.captureCharFrame().split("\n").find((line) => line.includes("Every 1h"))!
      expect(listRow).toContain("in 58 minutes")
      expect(listRow).not.toContain("min…")
    } finally { m.app.renderer.destroy() }
  })
  test.each(["zh", "en"] as const)("details omit session model settings to avoid implying execution configuration (%s)", async (language) => {
    const task: AutomationRow = { ...row("english"), tz: "Asia/Shanghai", session: { id: "session-1", title: "Original title" } }
    const m = await mount([task], 150, 44, language)
    try {
      const frame = m.app.captureCharFrame()
      for (const value of ["Asia/Shanghai", "Original title", "Prompt for english"]) expect(frame).toContain(value)
      for (const value of ["会话当前配置", "Current session configuration"]) expect(frame).not.toContain(value)
      const scheduleLabel = language === "zh" ? "任务 ID:" : "Automation ID:"
      const sessionLabel = language === "zh" ? "会话 ID:" : "Session ID:"
      const lines = frame.split("\n")
      const scheduleLine = lines.findIndex((line) => line.includes(scheduleLabel))
      const sessionLine = lines.findIndex((line) => line.includes(sessionLabel))
      expect(scheduleLine).toBeGreaterThan(-1)
      expect(sessionLine).toBeGreaterThan(scheduleLine)
      expect(lines[scheduleLine]).toContain("english")
      expect(lines[sessionLine]).toContain("session-1")
      // A plain prompt back to its creator needs no separate destination row.
      expect(frame).toMatch(language === "zh" ? /动作\s+提示词/ : /Action\s+Prompt/)
      expect(frame).not.toContain(language === "zh" ? "发送到" : "Sends to")
      if (language === "en") expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
    } finally { m.app.renderer.destroy() }
  })
  test("English narrow layouts retain the close entry and footer", async () => {
    for (const width of [48, 80]) {
      const m = await mount([row("a")], width, 18, "en")
      try {
        const lines = m.app.captureCharFrame().split("\n")
        expect(lines[1]).toContain("esc")
        expect(lines.join("\n")).toContain("↑↓ Select")
        expect(lines.join("\n")).toContain("esc Close")
        expect(lines.join("\n")).not.toMatch(/[\u4e00-\u9fff]/)
      } finally { m.app.renderer.destroy() }
    }
  })
  test("English empty, loading, failure and search states remain localized", async () => {
    const m = await mount([], 120, 26, "en")
    try {
      expect(m.app.captureCharFrame()).toContain("This session has no automations")
      m.setLoading(true)
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Reading tasks")
      m.setLoading(false)
      m.setError("Original error")
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Original error")
      expect(m.app.captureCharFrame()).toContain("Could not read tasks")
      await m.key("/")
      expect(m.app.captureCharFrame()).toContain("Search names, prompts, commands or sessions")
      expect(m.app.captureCharFrame()).toContain("Back to list")
    } finally { m.app.renderer.destroy() }
  })
  test("English unfocused hints name the new command and do not translate raw errors", async () => {
    let root: Parameters<NonNullable<import("./window").AutomationWindowProps["onRoot"]>>[0] | undefined
    const app = await testRender(() => <AutomationWindow language={() => "en"} rows={() => [row("a")]}
      loading={() => false} error={() => "原始错误"}
      currentSessionID={() => "session-1"} theme={() => theme} onRoot={(box) => { root = box }}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 120, height: 30 })
    try {
      await app.flush()
      expect(app.captureCharFrame()).toContain("✕ 原始错误")
      root?.blur()
      await app.flush()
      expect(app.captureCharFrame()).toContain("Click this window")
      expect(app.captureCharFrame()).toContain("keyboard is in the input")
      expect(app.captureCharFrame()).toContain("/automation_status")
    } finally { app.renderer.destroy() }
  })
  test("opens with the saved scope and status, and `c` opens settings only when the host offers it", async () => {
    const rows = [row("mine"), row("paused", "paused"), row("other", "paused", "session-2")]
    let opened = 0
    const app = await testRender(() => <AutomationWindow language={() => "en"} rows={() => rows} loading={() => false}
      error={() => undefined} currentSessionID={() => "session-1"} theme={() => theme}
      initialScope="all" initialFilter="paused" openSettings={() => { opened++ }}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 150, height: 30 })
    try {
      await app.flush()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Task other")
      expect(frame).toContain("Task paused")
      expect(frame).not.toContain("Task mine")
      expect(frame).toContain("c Settings")
      app.mockInput.pressKey("c")
      await new Promise((resolve) => setTimeout(resolve, 35))
      expect(opened).toBe(1)
    } finally { app.renderer.destroy() }
    const m = await mount([row("a")], 150, 30, "en")
    try { expect(m.app.captureCharFrame()).not.toContain("c Settings") } finally { m.app.renderer.destroy() }
  })
  test("sort and time display follow the settings live", async () => {
    const now = Date.now()
    const rows = [{ ...row("b"), name: "Beta", nextDueAt: now + 3 * 3_600_000 }, { ...row("a"), name: "Alpha", nextDueAt: now + 10 * 60_000 }]
    const [sort, setSort] = createSignal<"created" | "next" | "name">("created")
    const [time, setTime] = createSignal<"relative" | "absolute">("relative")
    const app = await testRender(() => <AutomationWindow language={() => "en"} rows={() => rows} loading={() => false}
      error={() => undefined} currentSessionID={() => "session-1"} theme={() => theme} sort={sort} timeFormat={time}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 150, height: 30 })
    const order = () => app.captureCharFrame().split("\n").filter((line) => line.includes("Every 1h"))
      .map((line) => line.includes("Alpha") ? "Alpha" : "Beta")
    try {
      await app.flush()
      expect(order()).toEqual(["Beta", "Alpha"])
      setSort("next")
      await app.flush()
      expect(order()).toEqual(["Alpha", "Beta"])
      const alpha = () => app.captureCharFrame().split("\n").find((line) => line.includes("Alpha") && line.includes("Every 1h"))!
      expect(alpha()).toContain("in 10 minutes")
      setTime("absolute")
      await app.flush()
      const clock = new Date(now + 10 * 60_000)
      expect(alpha()).toContain(`${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`)
      expect(alpha()).not.toContain("in 10 minutes")
    } finally { app.renderer.destroy() }
  })
  test("switches language live when the setting changes", async () => {
    const [language, setLanguage] = createSignal<Language>("zh")
    const app = await testRender(() => <AutomationWindow language={language} rows={() => [row("a")]} loading={() => false}
      error={() => undefined} currentSessionID={() => "session-1"} theme={() => theme}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 150, height: 30 })
    try {
      await app.flush()
      expect(app.captureCharFrame()).toContain("当前会话")
      setLanguage("en")
      await app.flush()
      expect(app.captureCharFrame()).toContain("Current session")
      expect(app.captureCharFrame()).not.toMatch(/[\u4e00-\u9fff]/)
    } finally { app.renderer.destroy() }
  })
  test("preserves IDs across refresh and clamps a removed selection", () => {
    expect(reconcileWindowSelection([row("b"), row("a")], "a", 0)).toBe("a")
    expect(reconcileWindowSelection([row("a"), row("c")], "b", 1)).toBe("c")
    expect(reconcileWindowSelection([], "b", 8)).toBeUndefined()
  })
  test("selects, delegates mutations, and repairs the selection after deletion", async () => {
    const m = await mount([row("a"), row("b", "paused"), row("c", "done")])
    try {
      await m.key("j")
      await m.key("p")
      expect(m.calls).toContain("resume:b")
      await m.key("d")
      await m.key("o")
      expect(m.calls).toContain("remove:b")
      expect(m.calls).toContain("open:c")
      await m.key("p")
      expect(m.calls).not.toContain("resume:c")
      await m.key("k")
      await m.key("p")
      expect(m.calls).toContain("pause:a")
    } finally { m.app.renderer.destroy() }
  })
  test("filters native status and current/all session scope", async () => {
    const m = await mount([row("active"), row("paused", "paused"), row("done", "done"), row("other", "active", "session-2")])
    try {
      expect(m.app.captureCharFrame()).not.toContain("Task other")
      await m.key("s")
      expect(m.app.captureCharFrame()).toContain("Task other")
      await m.key("right")
      expect(m.app.captureCharFrame()).not.toContain("Task paused")
      await m.key("tab")
      expect(m.app.captureCharFrame()).toContain("Task paused")
      expect(m.app.captureCharFrame()).not.toContain("Task active")
      await m.key("right")
      expect(m.app.captureCharFrame()).toContain("Task done")
      expect(m.app.captureCharFrame()).not.toContain("p 恢复")
    } finally { m.app.renderer.destroy() }
  })
  test("search isolates destructive shortcuts and Escape returns before closing", async () => {
    const m = await mount([row("a"), row("rdpojk")])
    try {
      await m.key("/")
      await m.app.mockInput.typeText("rdpojk")
      await m.app.flush()
      expect(m.calls).toEqual([])
      expect(m.app.captureCharFrame()).not.toContain("Task a")
      expect(m.app.captureCharFrame()).toContain("Task rdpojk")
      m.app.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await m.app.flush()
      expect(m.calls).toEqual([])
      await m.key("p")
      expect(m.calls).toContain("pause:rdpojk")
      m.app.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await m.app.flush()
      expect(m.calls).not.toContain("close")
      expect(m.app.captureCharFrame()).toContain("Task a")
      m.app.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await m.app.flush()
      expect(m.calls).toContain("close")
    } finally { m.app.renderer.destroy() }
  })
  test("keeps a fixed footer and scrollable list on a small terminal", async () => {
    const m = await mount(Array.from({ length: 30 }, (_, i) => row(String(i))), 48, 18)
    try {
      expect(m.app.captureCharFrame()).not.toContain("任务分类")
      for (let i = 0; i < 25; i++) await m.key("j")
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("Task 25")
      expect(frame).toContain("↑↓ 选择")
      await m.key("o")
      expect(m.calls).toContain("open:25")
    } finally { m.app.renderer.destroy() }
  })
  test("allows Escape while loading and renders empty/loading states", async () => {
    const m = await mount([])
    try {
      expect(m.app.captureCharFrame()).toContain("这个会话还没有自动化任务")
      m.setLoading(true)
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("正在读取任务")
      m.app.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await m.app.flush()
      expect(m.calls).toContain("close")
    } finally { m.app.renderer.destroy() }
  })
  test("has no manual create action and reports read failures", async () => {
    const m = await mount([])
    try {
      expect(m.app.captureCharFrame()).not.toContain("新建")
      expect(m.app.captureCharFrame()).toContain("让 agent 安排")
      await m.key("n")
      expect(m.calls).toEqual([])
      m.setError("Automation request failed")
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Automation request failed")
      expect(m.app.captureCharFrame()).toContain("任务读取失败")
      await m.key("r")
      expect(m.calls).toContain("refresh")
    } finally { m.app.renderer.destroy() }
  })
  test("host bindings are scoped away from search and disposed with the window", async () => {
    let target: (() => unknown) | undefined
    let actions: { key: string; run(): void }[] = []
    let disposed = false
    let pauses = 0
    const app = await testRender(() => <AutomationWindow language={() => "zh"} rows={() => [row("a")]} loading={() => false}
      error={() => undefined} currentSessionID={() => "session-1"} theme={() => theme}
      refresh={() => {}} pause={() => { pauses++ }} resume={() => {}} remove={() => {}}
      openSession={() => {}} close={() => {}}
      bindKeys={(getTarget, registered) => { target = getTarget; actions = registered; return () => { disposed = true } }}
    />, { width: 100, height: 24 })
    try {
      await app.flush()
      expect(target?.()).toBeDefined()
      actions.find((action) => action.key === "/")!.run()
      await app.flush()
      expect(target?.()).toBeUndefined()
      actions.find((action) => action.key === "p")!.run()
      expect(pauses).toBe(0)
      app.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await app.flush()
      expect(target?.()).toBeDefined()
      actions.find((action) => action.key === "p")!.run()
      await app.flush()
      expect(pauses).toBe(1)
    } finally { app.renderer.destroy() }
    expect(disposed).toBe(true)
  })
})
