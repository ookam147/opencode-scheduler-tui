import type { OpenCodeClient } from "@opencode/client";
import { type Automation, type AutomationRow } from "./model";
type AutomationAPI = Pick<OpenCodeClient["experimental"]["automation"], "list" | "pause" | "resume" | "delete">;
export type AutomationClientSource = {
    experimental: {
        automation: AutomationAPI;
    };
};
/** Reads a session the host already holds; the window never fetches sessions itself. */
export type SessionLookup = (sessionID: string) => {
    id: string;
    title?: string;
} | undefined;
export declare function createAutomationClient(client: AutomationClientSource, lookup?: SessionLookup): {
    /** Every automation the server lets this client see, oldest first, in one request. */
    list(options?: {
        signal?: AbortSignal;
    }): Promise<AutomationRow[]>;
    pause(id: string): Promise<Automation>;
    resume(id: string): Promise<Automation>;
    remove(id: string): Promise<void>;
};
export {};
