import { describe, expect, test, spyOn } from "bun:test"
import { detectLanguage, words } from "./i18n"

describe("native UI language", () => {
  test("uses the agreed execution note and explicit identifier labels", () => {
    expect(words("zh").executionNote).toBe("触发时向所属会话发送提示词，并直接沿用该会话的当前配置（未绑定独立模型）。")
    expect(words("zh").scheduleID).toBe("任务 ID")
    expect(words("zh").sessionID).toBe("会话 ID")
    expect(words("en").scheduleID).toBe("Schedule ID")
    expect(words("en").sessionID).toBe("Session ID")
  })
  test("maps Chinese time zones and legacy aliases explicitly", () => {
    for (const zone of ["Asia/Shanghai", "Asia/Chongqing", "Asia/Chungking", "Asia/Harbin", "Asia/Urumqi", "Asia/Hong_Kong", "Asia/Macau", "Asia/Macao", "Asia/Taipei", "PRC", "ROC", "Hongkong"]) {
      expect(detectLanguage(zone)).toBe("zh")
    }
    for (const zone of ["UTC", "Asia/Tokyo", "Asia/Singapore", "America/New_York", "Europe/London", "invalid", ""]) {
      expect(detectLanguage(zone)).toBe("en")
    }
  })
  test("defaults to the machine time zone and safely handles unavailable Intl", () => {
    const resolved = spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    try {
      resolved.mockReturnValue({ timeZone: "Asia/Taipei" } as Intl.ResolvedDateTimeFormatOptions)
      expect(detectLanguage()).toBe("zh")
      expect(words().cancel).toBe("取消")
      resolved.mockReturnValue({ timeZone: "Europe/Paris" } as Intl.ResolvedDateTimeFormatOptions)
      expect(detectLanguage()).toBe("en")
      resolved.mockImplementation(() => { throw new Error("Intl unavailable") })
      expect(detectLanguage()).toBe("en")
    } finally { resolved.mockRestore() }
  })
  test("provides both dictionaries and keeps dynamic names unchanged", () => {
    expect(Object.keys(words("en")).sort()).toEqual(Object.keys(words("zh")).sort())
    for (const language of ["en", "zh"] as const) {
      expect(words(language).deleteMessage("原名", "Original session")).toContain("原名")
      expect(words(language).deleteMessage("原名", "Original session")).toContain("Original session")
    }
  })
})
