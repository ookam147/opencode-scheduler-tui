/** Renders the window with sample automations as HTML frames for the README screenshots: `npm run screenshots`. */
import { test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdirSync, writeFileSync } from "node:fs"
import type { CapturedFrame } from "@opentui/core"
import { AutomationWindow, type AutomationWindowTheme } from "../src/native/window"
import type { AutomationRow } from "../src/native/model"
import type { Language } from "../src/native/i18n"
import { columns } from "../src/native/format"

const out = process.env.SCREENSHOT_DIR ?? "docs/screenshots/html"
// OpenCode's default light palette.
const theme: AutomationWindowTheme = {
  text: "#2f3542", muted: "#6b7280", faint: "#9aa0a6", accent: "#2a8a8a", background: "#eef0f3",
  raised: "#d9dce1", border: "#c3c7ce", success: "#3a9b3a", warning: "#d48a1f", error: "#d64545", info: "#2a8a8a",
}
// Times in the frames read as Shanghai local time, whatever machine renders them.
process.env.TZ = "Asia/Shanghai"
const now = Date.now()
const min = 60_000
const base = { directory: "/Users/you/projects/shop", tz: "Asia/Shanghai", sessionID: "ses_ops", session: { id: "ses_ops", title: "Shop operations" } }

function rows(language: Language): AutomationRow[] {
  const zh = language === "zh"
  return [
    { ...base, id: "aut_digest", name: zh ? "每日站会摘要" : "Daily standup digest", status: "active", runCount: 12,
      trigger: { type: "cron", cron: "0 9 * * 1-5" }, nextDueAt: now + 15 * 60 * min, lastRunAt: now - 9 * 60 * min, lastOutcome: "fired",
      action: { type: "prompt", prompt: zh ? "总结昨天合并的提交和未关闭的 PR，列出今天需要跟进的事项。" : "Summarize yesterday's merged commits and open PRs, and list what needs follow-up today.", to: { session: "ses_ops" } } },
    { ...base, id: "aut_orders", name: zh ? "异常订单监控" : "Order anomaly watch", status: "active", runCount: 37,
      trigger: { type: "every", every: "10 minutes" }, nextDueAt: now + 6 * min, lastRunAt: now - 4 * min, lastOutcome: "fired",
      action: { type: "code", code: [
        "const { orders } = await (await fetch(args.url)).json()",
        "const risky = orders.filter((o) => o.risk > 0.8)",
        "if (!risky.length) return { state }",
        zh ? "return { send: { prompt: `${risky.length} 个异常订单待核查` }," : "return { send: { prompt: `${risky.length} risky orders to review` },",
        "  state: { seen: risky.map((o) => o.id) } }",
      ].join("\n") },
      lastOutput: zh ? "Prompted ses_ops\n检查了 48 个订单，2 个风险较高" : "Prompted ses_ops\nChecked 48 orders, 2 high-risk", state: { seen: ["#1043", "#1051"] } },
    { ...base, id: "aut_backup", name: zh ? "数据库备份" : "Database backup", status: "active", runCount: 30,
      trigger: { type: "cron", cron: "0 3 * * *" }, nextDueAt: now + 11 * 60 * min, lastRunAt: now - 13 * 60 * min, lastOutcome: "fired",
      action: { type: "shell", command: "./scripts/backup.sh" }, lastOutput: "Exit code: 0\nbackup-2026-11-24.sql.gz 18.4 MB" },
    { ...base, id: "aut_report", name: zh ? "周报整理" : "Weekly report", status: "active", runCount: 4,
      trigger: { type: "cron", cron: "0 17 * * 5" }, nextDueAt: now + 3 * 24 * 60 * min, lastRunAt: now - 4 * 24 * 60 * min, lastOutcome: "fired",
      action: { type: "prompt", prompt: zh ? "整理本周的销售数据和客服记录，写成一份周报。" : "Compile this week's sales and support tickets into a report.", to: { subagent: "general" } },
      lastOutput: "Started subagent ses_aut_report_4" },
    { ...base, id: "aut_health", name: zh ? "接口健康检查" : "API health check", status: "active", runCount: 210,
      trigger: { type: "every", every: "5 minutes" }, nextDueAt: now + 2 * min, lastRunAt: now - 3 * min, lastOutcome: "failed",
      action: { type: "shell", command: "curl -sf https://api.example.com/health" }, lastOutput: "Exit code: 22\ncurl: (22) The requested URL returned error: 503" },
    { ...base, id: "aut_release", name: zh ? "发版提醒" : "Release reminder", status: "paused", runCount: 0,
      trigger: { type: "at", at: "2026-12-01T10:00:00+08:00" }, action: { type: "prompt", prompt: zh ? "提醒我检查发版清单。" : "Remind me to check the release checklist.", to: { session: "ses_ops" } } },
    { ...base, id: "aut_water", name: zh ? "喝水提醒" : "Drink water", status: "done", runCount: 1,
      trigger: { type: "at", at: "2026-11-24T11:31:08+08:00" }, lastRunAt: now - 3 * 60 * min, lastOutcome: "fired",
      action: { type: "prompt", prompt: zh ? "提醒我喝水。" : "Remind me to drink water.", to: { session: "ses_ops" } } },
  ] as AutomationRow[]
}

const rgba = (c: { r: number; g: number; b: number; a: number }) =>
  `rgba(${[c.r, c.g, c.b].map((v) => Math.round(v * 255)).join(",")},${c.a})`
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const CELL = 9.6
const ROW = 22
/** One absolutely placed box per run of same-styled cells, so wide (CJK) characters keep the terminal grid. */
function html(frame: CapturedFrame) {
  const boxes: string[] = []
  frame.lines.forEach((line, y) => {
    let x = 0
    for (const span of line.spans) {
      const bg = span.bg.a > 0 ? `background:${rgba(span.bg)};` : ""
      const bold = span.attributes & 1 ? "font-weight:700;" : ""
      if (bg) boxes.push(`<i style="left:${x * CELL}px;top:${y * ROW}px;width:${span.width * CELL}px;height:${ROW}px;${bg}"></i>`)
      let cx = x
      for (const char of span.text) {
        const w = columns(char)
        if (char !== " ") boxes.push(`<b style="left:${cx * CELL}px;top:${y * ROW}px;width:${w * CELL}px;color:${rgba(span.fg)};${bold}">${esc(char)}</b>`)
        cx += w
      }
      x += span.width
    }
  })
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${theme.background}}
main{position:relative;margin:16px;width:${frame.cols * CELL}px;height:${frame.rows * ROW}px}
i,b{position:absolute;display:block}
b{height:${ROW}px;line-height:${ROW}px;text-align:center;font:400 16px "JetBrains Mono","SF Mono",Menlo,"PingFang SC",monospace}
</style><main>${boxes.join("")}</main>`
}

async function shot(name: string, language: Language, select: number, keys: string[] = []) {
  const items = rows(language)
  const app = await testRender(() => <AutomationWindow language={() => language} rows={() => items} loading={() => false}
    error={() => undefined} currentSessionID={() => "ses_ops"} theme={() => theme} openSettings={() => {}}
    refresh={() => {}} pause={() => {}} resume={() => {}} remove={() => {}} openSession={() => {}} close={() => {}} />,
    { width: 150, height: 40 })
  await app.flush()
  for (let i = 0; i < select; i++) { app.mockInput.pressArrow("down"); await app.flush() }
  for (const key of keys) app.mockInput.pressKey(key)
  await new Promise((resolve) => setTimeout(resolve, 60))
  await app.flush()
  writeFileSync(`${out}/${name}.html`, html(app.captureSpans()))
  app.renderer.destroy()
}

test("renders README screenshots", async () => {
  mkdirSync(out, { recursive: true })
  for (const language of ["zh", "en"] as const) {
    await shot(`window-${language}`, language, 1)
    await shot(`help-${language}`, language, 1, ["h"])
  }
}, 30_000)
