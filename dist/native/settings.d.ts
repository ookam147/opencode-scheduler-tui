import type { Language } from "./i18n";
import type { AutomationFilter, AutomationSort } from "./model";
export type Scope = "current" | "all";
/** How the list's "Next" column shows a due time: "in 3 minutes" or "Today 09:05". */
export type TimeFormat = "relative" | "absolute";
/** Preferences saved by the host's plugin storage; shared by every running TUI. */
export type Settings = {
    language: Language;
    /** Seconds between silent refreshes while the window is open; 0 refreshes only on demand. */
    refresh: number;
    /** Scope and status the window opens with. */
    scope: Scope;
    filter: AutomationFilter;
    sort: AutomationSort;
    time: TimeFormat;
};
export type SettingKey = keyof Settings;
export declare const DEFAULT_SETTINGS: Settings;
export declare const LANGUAGES: Language[];
export declare const REFRESH_CHOICES: number[];
export declare const SCOPES: Scope[];
export declare const FILTERS: AutomationFilter[];
export declare const SORTS: AutomationSort[];
export declare const TIME_FORMATS: TimeFormat[];
/** A stored file may predate a setting or have been edited by hand; unknown values fall back to defaults. */
export declare function normalizeSettings(value: Partial<Record<SettingKey, unknown>> | undefined): Settings;
