import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { type SchedulerJobStatus } from "./status.js";
declare const id = "opencode-scheduler";
type Filter = "all" | "running" | "paused" | "problems";
export declare function filterSchedulerJobs(jobs: SchedulerJobStatus[], options: {
    query?: string;
    filter?: Filter;
    scopeId?: string;
}): SchedulerJobStatus[];
declare const tui: TuiPlugin;
export { id, tui };
declare const _default: {
    id: string;
    tui: TuiPlugin;
};
export default _default;
