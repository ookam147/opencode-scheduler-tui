import { describe, expect, test } from "bun:test"
import { LANGUAGE_NAMES, words } from "./i18n"

describe("native UI language", () => {
  test("labels every automation outcome in both languages", () => {
    for (const language of ["zh", "en"] as const) {
      expect(Object.keys(words(language).outcomes).sort()).toEqual(["disabled", "expired", "failed", "fired", "late", "skipped"])
    }
    expect(words("zh").outcomes.disabled).toBe("配置已关闭")
    expect(words("en").outcomes.expired).toBe("Expired")
  })
  test("explains each action kind, including subagent runs and the code failure pause", () => {
    for (const language of ["zh", "en"] as const) {
      const notes = words(language).executionNotes
      expect(notes.prompt).toContain(language === "zh" ? "未绑定独立模型" : "no separate model is bound")
      expect(notes.subagent("explore")).toContain("explore")
      expect(notes.code).toContain(language === "zh" ? "连续 3 次失败" : "Three consecutive failures")
      expect(notes.shell).toContain(language === "zh" ? "退出码" : "exit code")
    }
  })
  test("uses explicit identifier labels", () => {
    expect(words("zh").automationID).toBe("任务 ID")
    expect(words("zh").sessionID).toBe("会话 ID")
    expect(words("en").automationID).toBe("Automation ID")
    expect(words("en").sessionID).toBe("Session ID")
  })
  test("defaults to Chinese and names each language in itself", () => {
    expect(words().cancel).toBe("取消")
    expect(LANGUAGE_NAMES).toEqual({ zh: "简体中文", en: "English" })
  })
  test("provides both dictionaries and keeps dynamic names unchanged", () => {
    expect(Object.keys(words("en")).sort()).toEqual(Object.keys(words("zh")).sort())
    for (const language of ["en", "zh"] as const) {
      expect(words(language).deleteMessage("原名", "Original session")).toContain("原名")
      expect(words(language).deleteMessage("原名", "Original session")).toContain("Original session")
    }
  })
})
