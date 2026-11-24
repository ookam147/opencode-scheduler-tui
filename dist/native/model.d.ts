/** Mirrors `Automation.Info` from OpenCode 2.4; timestamps are epoch milliseconds. */
export type AutomationTrigger = {
    type: "at";
    at: string;
    tz?: string;
} | {
    type: "every";
    every: string;
    tz?: string;
} | {
    type: "cron";
    cron: string;
    tz?: string;
} | {
    type: "event";
    server: string;
    event: string;
    args?: Record<string, unknown>;
};
export type AutomationTarget = {
    session: string;
    subagent?: never;
} | {
    subagent: string;
    session?: never;
};
export type AutomationAction = {
    type: "prompt";
    prompt: string;
    to: AutomationTarget;
} | {
    type: "code";
    code: string;
    args?: unknown;
} | {
    type: "shell";
    command: string;
};
export type AutomationActionType = AutomationAction["type"];
export type AutomationStatus = "active" | "paused" | "done";
export type AutomationOutcome = "fired" | "late" | "skipped" | "disabled" | "failed" | "expired";
export type Automation = {
    id: string;
    name: string;
    projectID?: string;
    /** The session that created it. Deleting that session does not delete the automation. */
    sessionID?: string;
    directory: string;
    trigger: AutomationTrigger;
    tz: string;
    action: AutomationAction;
    expires?: number;
    status: AutomationStatus;
    nextDueAt?: number;
    runCount: number;
    lastRunAt?: number;
    lastOutcome?: AutomationOutcome;
    lastOutput?: string;
    time?: {
        created: number;
        updated: number;
    };
};
/** What the TUI already knows about a session; never fetched just for this window. */
export type AutomationSession = {
    id: string;
    title?: string;
};
export type AutomationRow = Automation & {
    session?: AutomationSession;
    target?: AutomationSession;
};
export type AutomationFilter = "all" | AutomationStatus;
/** `created` keeps the service's order (oldest first). */
export type AutomationSort = "created" | "next" | "name";
/** The session a prompt lands in: an explicit target, else the creator (code sends and subagent runs start there). */
export declare function targetSessionID(row: Automation): string | undefined;
/** Whether an automation concerns a session: created there, or prompting it. */
export declare function belongsTo(row: Automation, sessionID: string | undefined): boolean;
/** The body of an action: its prompt, script or command. */
export declare function actionBody(action: AutomationAction): string;
export declare function describeTrigger(trigger: AutomationTrigger): string;
export declare function selectAutomations(rows: AutomationRow[], options?: {
    status?: AutomationFilter;
    sessionID?: string;
    query?: string;
}): AutomationRow[];
/** A sorted copy. Ties keep the service's creation order, since `Array.prototype.sort` is stable. */
export declare function sortAutomations<Row extends Automation>(rows: Row[], sort: AutomationSort, locale?: string): Row[];
export declare function countAutomations(rows: Automation[]): {
    all: number;
    active: number;
    paused: number;
    done: number;
};
