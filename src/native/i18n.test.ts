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
  test("help explains every list marker and action kind in both languages, in the same shape", () => {
    const shape = (language: "zh" | "en") => words(language).helpSections.map((section) => section.items.length)
    expect(shape("en")).toEqual(shape("zh"))
    for (const language of ["zh", "en"] as const) {
      const [markers, actions] = words(language).helpSections
      expect(markers!.items.map(([key]) => key)).toEqual(expect.arrayContaining(["●", "‖", "✓", "↳", "λ", "$"]))
      const body = actions!.items.map(([, value]) => value).join(" ")
      expect(body).toContain(language === "zh" ? "原会话收不到消息" : "the original session gets no message")
      expect(body).toContain(language === "zh" ? "连续失败 3 次" : "3 failures in a row")
      expect(body).toContain(language === "zh" ? "退出码" : "exit code")
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
