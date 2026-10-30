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
export type NativeSchedule = {
    id: string;
    sessionID?: string;
    name?: string;
    prompt: string;
    when: ScheduleWhen;
    tz: string;
    status: "active" | "paused" | "done";
    nextDueAt?: number;
    endsAt?: number;
    remainingRuns?: number;
    runCount: number;
    lastFiredAt?: number;
    lastOutcome?: "fired" | "late" | "skipped" | "disabled" | "failed";
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
