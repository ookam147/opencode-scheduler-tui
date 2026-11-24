/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, RGBA } from "@opentui/core";
import { type Accessor, type JSX } from "solid-js";
import { type AutomationFilter, type AutomationSort, type AutomationRow } from "./model";
import { type Language } from "./i18n";
import { type Scope, type TimeFormat } from "./settings";
export type AutomationWindowTheme = Record<"text" | "muted" | "accent" | "background" | "raised" | "border" | "success" | "warning" | "error" | "info", string | RGBA> & {
    faint?: string | RGBA;
};
export type AutomationWindowProps = {
    language?: Accessor<Language>;
    /** Scope and status the window opens with; later changes are the user's. */
    initialScope?: Scope;
    initialFilter?: AutomationFilter;
    /** List order and how its "Next" column shows times; both follow the settings live. */
    sort?: Accessor<AutomationSort>;
    timeFormat?: Accessor<TimeFormat>;
    rows: Accessor<AutomationRow[]>;
    loading: Accessor<boolean>;
    error: Accessor<string | undefined>;
    currentSessionID: Accessor<string | undefined>;
    theme: Accessor<AutomationWindowTheme>;
    refresh(): void | Promise<void>;
    pause(row: AutomationRow): void | Promise<void>;
    resume(row: AutomationRow): void | Promise<void>;
    remove(row: AutomationRow): void | Promise<void>;
    openSession(row: AutomationRow): void | Promise<void>;
    close(): void | Promise<void>;
    /** Rows the window may take; it fills its parent when omitted. */
    height?: Accessor<number | undefined>;
    /** The window's own box, for the host to focus and measure. */
    onRoot?(box: BoxRenderable): void;
    /** Opens the host's settings dialog; the shortcut is hidden without it. */
    openSettings?(): void | Promise<void>;
    bindKeys?(target: () => BoxRenderable | undefined, actions: {
        key: string;
        run: () => void;
    }[]): () => void;
};
type KeyHint = {
    key: string;
    label: string;
};
/** Keep the same automation through refresh/reordering; otherwise choose its nearest neighbour. */
export declare function reconcileWindowSelection(rows: AutomationRow[], id: string | undefined, previousIndex?: number): string;
/** Key hints in `width` columns, broken between hints, never inside one. */
export declare function keyHintLines(hints: KeyHint[], width: number): KeyHint[][];
/** A session-native view: every mutation and navigation is delegated to the host. */
export declare function AutomationWindow(props: AutomationWindowProps): JSX.Element;
export {};
