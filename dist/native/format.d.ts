import type { NativeSchedule } from "./model";
import { type Language } from "./i18n";
export declare const STATUS_LABELS: {
    readonly all: "全部";
    readonly active: "运行中";
    readonly paused: "已暂停";
    readonly done: "已结束";
};
export declare const STATUS_GLYPHS: {
    readonly active: "●";
    readonly paused: "‖";
    readonly done: "✓";
};
export declare const OUTCOME_LABELS: Record<NonNullable<NativeSchedule["lastOutcome"]>, string>;
export declare function columns(text: string): number;
/** Exactly `width` columns: cut with "…" when too long, padded with spaces when short. */
export declare function fit(text: string, width: number, align?: "left" | "right"): string;
/** "今天 09:00", "明天 09:00", "11-03 09:00" or "2027-01-02 09:00". */
export declare function clockTime(ms: number | undefined, now?: number, language?: Language): string;
/** "3 分钟后", "2 小时前", "刚刚". */
export declare function relativeTime(ms: number | undefined, now?: number, language?: Language): string;
/** The list's right column: when it fires next, or why it won't. */
export declare function nextLabel(row: Pick<NativeSchedule, "status" | "nextDueAt">, now?: number, language?: Language): string;
