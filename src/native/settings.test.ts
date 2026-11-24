import { expect, test } from "bun:test"
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings"

test("missing or unknown stored values fall back to defaults, valid ones are kept", () => {
  expect(normalizeSettings(undefined)).toEqual({ language: "zh", refresh: 5, scope: "current", filter: "all", sort: "created", time: "relative" })
  const chosen = { language: "en", refresh: 0, scope: "all", filter: "paused", sort: "next", time: "absolute" } as const
  expect(normalizeSettings(chosen)).toEqual(chosen)
  expect(normalizeSettings({ language: "fr", refresh: 7, scope: "x", filter: 1, sort: "size", time: "iso" })).toEqual(DEFAULT_SETTINGS)
  // A file saved before sort and time existed keeps its other choices.
  expect(normalizeSettings({ language: "en" })).toEqual({ ...DEFAULT_SETTINGS, language: "en" })
})
