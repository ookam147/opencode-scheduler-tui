import { describe, expect, test, spyOn } from "bun:test"
import { detectLanguage, words } from "./i18n"

describe("native UI language", () => {
  test("labels the two new check outcomes in both languages", () => {
    expect(words("zh").outcomes.checked).toBe("已检查未触发")
    expect(words("zh").outcomes.expired).toBe("条件超时")
    expect(words("en").outcomes.checked).toBe("Checked, did not fire")
    expect(words("en").outcomes.expired).toBe("Condition timed out")
  })
  test("states that gate checks run without a model call and that repeated failures pause the task", () => {
    for (const language of ["zh", "en"] as const) {
      const text = words(language)
      expect(`${text.conditionIfNote} ${text.conditionUntilNote}`)
        .toContain(language === "zh" ? "不调用模型" : "no model call")
      expect(text.conditionFailureNote).toContain(language === "zh" ? "3 次" : "Three")
      // An `until` gate still wakes the session when it times out, so the wording must not promise silence.
      expect(text.conditionUntilNote).toContain(language === "zh" ? "超时也会发送提示词" : "On timeout the prompt is still sent")
    }
  })
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
