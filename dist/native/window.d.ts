/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, RGBA } from "@opentui/core";
import { type Accessor, type JSX } from "solid-js";
import { type ScheduleRow } from "./model";
import { type Language } from "./i18n";
export type ScheduleWindowTheme = Record<"text" | "muted" | "accent" | "background" | "raised" | "border" | "success" | "warning" | "error", string | RGBA> & {
    faint?: string | RGBA;
};
export type ScheduleWindowProps = {
    language?: Language;
    rows: Accessor<ScheduleRow[]>;
    loading: Accessor<boolean>;
    error: Accessor<string | undefined>;
    /** Sessions whose schedules could not be read; the rest of the list is still shown. */
    warnings?: Accessor<string[]>;
    currentSessionID: Accessor<string | undefined>;
    theme: Accessor<ScheduleWindowTheme>;
    refresh(): void | Promise<void>;
    pause(row: ScheduleRow): void | Promise<void>;
    resume(row: ScheduleRow): void | Promise<void>;
    remove(row: ScheduleRow): void | Promise<void>;
    openSession(row: ScheduleRow): void | Promise<void>;
    close(): void | Promise<void>;
    /** Rows the window may take; it fills its parent when omitted. */
    height?: Accessor<number | undefined>;
    /** The window's own box, for the host to focus and measure. */
    onRoot?(box: BoxRenderable): void;
    scopeChanged?(scope: "current" | "all"): void;
    bindKeys?(target: () => BoxRenderable | undefined, actions: {
        key: string;
        run: () => void;
    }[]): () => void;
};
type KeyHint = {
    key: string;
    label: string;
};
/** Keep the same schedule through refresh/reordering; otherwise choose its nearest neighbour. */
export declare function reconcileWindowSelection(rows: ScheduleRow[], id: string | undefined, previousIndex?: number): string;
/** Key hints in `width` columns, broken between hints, never inside one. */
export declare function keyHintLines(hints: KeyHint[], width: number): KeyHint[][];
/** A session-native view: every mutation and navigation is delegated to the host. */
export declare function ScheduleWindow(props: ScheduleWindowProps): JSX.Element;
export {};
