import type { OpenCodeClient } from "@opencode/client";
import type { NativeSchedule, ScheduleRow } from "./model";
type ScheduleAPI = Pick<OpenCodeClient["experimental"]["schedule"], "list" | "pause" | "resume" | "delete">;
export type NativeScheduleClientSource = {
    experimental: {
        schedule: ScheduleAPI;
    };
    session: Pick<OpenCodeClient["session"], "list" | "get">;
};
export declare function createNativeScheduleClient(client: NativeScheduleClientSource, language?: "zh" | "en", options?: {
    directoryExists?: (directory: string) => Promise<boolean>;
}): {
    list(options: {
        scope: "current" | "all";
        sessionID?: string;
        signal?: AbortSignal;
    }): Promise<{
        rows: ScheduleRow[];
        warnings: string[];
    }>;
    pause(id: string): Promise<NativeSchedule>;
    resume(id: string): Promise<NativeSchedule>;
    remove(id: string): Promise<void>;
};
export {};
