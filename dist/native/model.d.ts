/** Native schedules belong to sessions, not filesystem scheduler scopes. */
export type ScheduleWhen = {
    type: "in";
    in: string;
    tz?: string;
} | {
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
};
/**
 * A gate the service evaluates before waking the session, with no model call. At most one predicate out of `is`,
 * `matches` and `changes` applies; with none of them, exit code 0 alone passes.
 */
export type ScheduleCondition = {
    type: "shell";
    run: string;
    is?: string;
    matches?: string;
    changes?: boolean;
} | {
    type: "code";
    code: string;
};
/** `if` gates every recurring slot; `until` polls until it passes once. The service stores at most one of them. */
export type ScheduleCheckMode = "if" | "until";
export type ScheduleCheck = {
    mode: ScheduleCheckMode;
    condition: ScheduleCondition;
};
export type ScheduleOutcome = "fired" | "late" | "checked" | "expired" | "skipped" | "disabled" | "failed";
export type NativeSchedule = {
    id: string;
    sessionID?: string;
    name?: string;
    prompt: string;
    when: ScheduleWhen;
    tz: string;
    if?: ScheduleCondition;
    until?: ScheduleCondition;
    status: "active" | "paused" | "done";
    nextDueAt?: number;
    endsAt?: number;
    remainingRuns?: number;
    runCount: number;
    lastFiredAt?: number;
    lastOutcome?: ScheduleOutcome;
    time?: {
        created: number;
        updated: number;
    };
};
export type ScheduleSession = {
    id: string;
    title?: string;
    directory?: string;
    agent?: string;
    /** Current session selection, not the configuration of any historical schedule firing. */
    model?: {
        id: string;
        providerID: string;
        variant?: string;
    };
};
export type ScheduleRow = NativeSchedule & {
    session?: ScheduleSession;
};
export type ScheduleFilter = "all" | NativeSchedule["status"];
export declare function describeWhen(when: ScheduleWhen): string;
/** The single gate stored on a schedule, if any. */
export declare function scheduleCheck(row: NativeSchedule): ScheduleCheck | undefined;
/** Mirrors the service's own condition summary: the command itself, or the first non-empty line of a code check. */
export declare function describeCondition(condition: ScheduleCondition): string;
export declare function selectSchedules(rows: ScheduleRow[], options?: {
    status?: ScheduleFilter;
    sessionID?: string;
    query?: string;
}): ScheduleRow[];
export declare function countSchedules(rows: NativeSchedule[]): {
    all: number;
    active: number;
    paused: number;
    done: number;
};
