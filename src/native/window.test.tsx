import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { ScheduleRow } from "./model"
import type { Language } from "./i18n"
import { columns } from "./format"
import { reconcileWindowSelection, ScheduleWindow, type ScheduleWindowTheme } from "./window"

const theme: ScheduleWindowTheme = {
  text: "#ffffff", muted: "#999999", accent: "#55aaff", background: "#101010",
  raised: "#303030", border: "#555555", success: "#22cc88", warning: "#ffaa33", error: "#ff5555",
}
function row(id: string, status: ScheduleRow["status"] = "active", sessionID = "session-1"): ScheduleRow {
  return { id, name: `Task ${id}`, prompt: `Prompt for ${id}`, when: { type: "every", every: "1h" }, tz: "UTC", status, sessionID, runCount: 3, lastOutcome: "fired" }
}
async function mount(rows: ScheduleRow[], width = 110, height = 26, language: Language = "zh") {
  const [items, setItems] = createSignal(rows)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const calls: string[] = []
  const app = await testRender(() => <ScheduleWindow language={language} rows={items} loading={loading} error={error}
    currentSessionID={() => "session-1"} theme={() => theme}
    refresh={() => { calls.push("refresh") }} pause={(row) => { calls.push(`pause:${row.id}`) }}
    resume={(row) => { calls.push(`resume:${row.id}`) }} remove={(row) => { calls.push(`remove:${row.id}`); setItems(items().filter((item) => item.id !== row.id)) }}
    openSession={(row) => { calls.push(`open:${row.id}`) }} close={() => { calls.push("close") }}
  />, { width, height })
  await app.flush()
  async function key(value: string) {
    if (value === "right" || value === "left") app.mockInput.pressArrow(value)
    else if (value === "tab") app.mockInput.pressTab()
    else app.mockInput.pressKey(value)
    await new Promise((resolve) => setTimeout(resolve, 35))
    await app.flush()
  }
  return { app, calls, setItems, setLoading, setError, key }
}

describe("native schedule window", () => {
  test.each(["zh", "en"] as const)("explains a shell `until` gate and its predicate (%s)", async (language) => {
    const gated: ScheduleRow = { ...row("gated"), name: "Deploy watch",
      until: { type: "shell", run: "curl -sf https://example.com/health", matches: "^ok$" } }
    const m = await mount([gated], 150, 44, language)
    try {
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("curl -sf https://example.com/health")
      expect(frame).toContain("^ok$")
      // The one-shot wording must be distinguishable from the recurring gate.
      expect(frame).toContain(language === "zh" ? "满足即结束（until）" : "Fires once when met (until)")
      expect(frame).not.toContain(language === "zh" ? "每次检查（if）" : "Checked each slot (if)")
      expect(frame).toContain(language === "zh" ? "连续 3 次检查失败" : "Three consecutive check failures")
      if (language === "en") expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
    } finally { m.app.renderer.destroy() }
  })
  test("shows a code gate with its confinement note, and marks only gated rows in the list", async () => {
    const plain = row("plain")
    const coded: ScheduleRow = { ...row("coded"), name: "Inbox watch",
      if: { type: "code", code: "const t = await tools.slack.read_thread({ id })\nreturn t.count > 0" } }
    const m = await mount([plain, coded], 150, 44, "zh")
    try {
      const lines = m.app.captureCharFrame().split("\n")
      // Match the list rows by their status glyph, since the detail pane repeats the selected task's name.
      const plainRow = lines.find((line) => line.includes("● Task plain"))!
      const codedRow = lines.find((line) => line.includes("Inbox watch"))!
      expect(codedRow).toContain("◆")
      expect(plainRow).not.toContain("◆")
      // Columns must stay aligned even though the marker only appears on one row. The status rail holds a
      // different number of CJK characters per line, so compare display columns rather than string indexes.
      const column = (line: string) => {
        const index = line.indexOf("每隔 1h")
        return index < 0 ? -1 : columns(line.slice(0, index))
      }
      expect(column(plainRow)).toBeGreaterThan(-1)
      expect(column(codedRow)).toBe(column(plainRow))
      await m.key("down")
      const frame = m.app.captureCharFrame()
      expect(frame).toContain("每次检查（if）")
      expect(frame).toContain("tools.slack.read_thread")
      expect(frame).toContain("无网络访问")
      // A code gate has no shell predicate to report.
      expect(frame).not.toContain("判定")
    } finally { m.app.renderer.destroy() }
  })
  test.each(["zh", "en"] as const)("details omit session model settings to avoid implying execution configuration (%s)", async (language) => {
    const task = { ...row("english"), tz: "Asia/Shanghai", session: { id: "session-1", title: "Original title", agent: "build", model: { id: "glm-5.3", providerID: "zai-coding-plan", variant: "max" } } }
    const m = await mount([task], 150, 44, language)
    try {
      const frame = m.app.captureCharFrame()
      for (const value of ["Asia/Shanghai", "Original title", "Prompt for english"]) expect(frame).toContain(value)
      for (const value of ["会话当前配置", "Current session configuration", "glm-5.3", "zai-coding-plan", "max", "build"]) expect(frame).not.toContain(value)
      const scheduleLabel = language === "zh" ? "任务 ID:" : "Schedule ID:"
      const sessionLabel = language === "zh" ? "会话 ID:" : "Session ID:"
      const lines = frame.split("\n")
      const scheduleLine = lines.findIndex((line) => line.includes(scheduleLabel))
      const sessionLine = lines.findIndex((line) => line.includes(sessionLabel))
      expect(scheduleLine).toBeGreaterThan(-1)
      expect(sessionLine).toBeGreaterThan(scheduleLine)
      expect(lines[scheduleLine]).toContain("english")
      expect(lines[sessionLine]).toContain("session-1")
      expect(frame).toContain(language === "zh" ? "执行方式" : "Execution")
      expect(frame).toContain(language === "zh" ? "未绑定独立模型" : "separate model is bound")
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
      expect(m.app.captureCharFrame()).toContain("This session has no scheduled tasks")
      m.setLoading(true)
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Reading tasks")
      m.setLoading(false)
      m.setError("Original error")
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Original error")
      expect(m.app.captureCharFrame()).toContain("Could not read tasks")
      await m.key("/")
      expect(m.app.captureCharFrame()).toContain("Search names, prompts or sessions")
      expect(m.app.captureCharFrame()).toContain("Back to list")
    } finally { m.app.renderer.destroy() }
  })
  test("English warnings and unfocused hints do not translate raw errors", async () => {
    let root: Parameters<NonNullable<import("./window").ScheduleWindowProps["onRoot"]>>[0] | undefined
    const app = await testRender(() => <ScheduleWindow language="en" rows={() => [row("a")]}
      loading={() => false} error={() => undefined} warnings={() => ["Original session: 原始错误"]}
      currentSessionID={() => "session-1"} theme={() => theme} onRoot={(box) => { root = box }}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 120, height: 30 })
    try {
      await app.flush()
      expect(app.captureCharFrame()).toContain("Could not read tasks from 1 session(s)")
      app.mockInput.pressKey("w")
      await new Promise((resolve) => setTimeout(resolve, 35))
      await app.flush()
      expect(app.captureCharFrame()).toContain("Read issues (1)")
      expect(app.captureCharFrame()).toContain("Original session: 原始错误")
      root?.blur()
      await app.flush()
      expect(app.captureCharFrame()).toContain("Click this window")
      expect(app.captureCharFrame()).toContain("keyboard is in the input")
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
      expect(m.app.captureCharFrame()).toContain("这个会话还没有定时任务")
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
      m.setError("Native schedule request failed")
      await m.app.flush()
      expect(m.app.captureCharFrame()).toContain("Native schedule request failed")
      expect(m.app.captureCharFrame()).toContain("任务读取失败")
      await m.key("r")
      expect(m.calls).toContain("refresh")
    } finally { m.app.renderer.destroy() }
  })
  test("summarises partial read failures on one line and lists them on demand", async () => {
    const app = await testRender(() => <ScheduleWindow language="zh" rows={() => [row("a")]} loading={() => false}
      error={() => undefined} warnings={() => ["旧工作树（ses_x）：UnexpectedStatus: 500"]}
      currentSessionID={() => "session-1"} theme={() => theme}
      refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
      { width: 120, height: 26 })
    try {
      await app.flush()
      expect(app.captureCharFrame()).toContain("1 个会话的任务读取失败")
      expect(app.captureCharFrame()).not.toContain("UnexpectedStatus")
      app.mockInput.pressKey("w")
      await new Promise((resolve) => setTimeout(resolve, 35))
      await app.flush()
      expect(app.captureCharFrame()).toContain("UnexpectedStatus: 500")
    } finally { app.renderer.destroy() }
  })
  test("host bindings are scoped away from search and disposed with the window", async () => {
    let target: (() => unknown) | undefined
    let actions: { key: string; run(): void }[] = []
    let disposed = false
    let pauses = 0
    const app = await testRender(() => <ScheduleWindow language="zh" rows={() => [row("a")]} loading={() => false}
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
