import type { Language } from "./i18n"
import type { AutomationFilter, AutomationSort } from "./model"

export type Scope = "current" | "all"
/** How the list's "Next" column shows a due time: "in 3 minutes" or "Today 09:05". */
export type TimeFormat = "relative" | "absolute"

/** Preferences saved by the host's plugin storage; shared by every running TUI. */
export type Settings = {
  language: Language
  /** Seconds between silent refreshes while the window is open; 0 refreshes only on demand. */
  refresh: number
  /** Scope and status the window opens with. */
  scope: Scope
  filter: AutomationFilter
  sort: AutomationSort
  time: TimeFormat
}
export type SettingKey = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  language: "zh", refresh: 5, scope: "current", filter: "all", sort: "created", time: "relative",
}

export const LANGUAGES: Language[] = ["zh", "en"]
export const REFRESH_CHOICES = [5, 10, 30, 60, 0]
export const SCOPES: Scope[] = ["current", "all"]
export const FILTERS: AutomationFilter[] = ["all", "active", "paused", "done"]
export const SORTS: AutomationSort[] = ["created", "next", "name"]
export const TIME_FORMATS: TimeFormat[] = ["relative", "absolute"]

const pick = <T>(choices: readonly T[], value: unknown, fallback: T) =>
  choices.includes(value as T) ? value as T : fallback

/** A stored file may predate a setting or have been edited by hand; unknown values fall back to defaults. */
export function normalizeSettings(value: Partial<Record<SettingKey, unknown>> | undefined): Settings {
  return {
    language: pick(LANGUAGES, value?.language, DEFAULT_SETTINGS.language),
    refresh: pick(REFRESH_CHOICES, value?.refresh, DEFAULT_SETTINGS.refresh),
    scope: pick(SCOPES, value?.scope, DEFAULT_SETTINGS.scope),
    filter: pick(FILTERS, value?.filter, DEFAULT_SETTINGS.filter),
    sort: pick(SORTS, value?.sort, DEFAULT_SETTINGS.sort),
    time: pick(TIME_FORMATS, value?.time, DEFAULT_SETTINGS.time),
  }
}
