import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui";
import { type SchedulerJobStatus, type SchedulerStatusSnapshot } from "./status.js";
declare const id = "opencode-scheduler";
type Filter = "all" | "running" | "paused" | "problems";
export declare function filterSchedulerJobs(jobs: SchedulerJobStatus[], options: {
    query?: string;
    filter?: Filter;
    scopeId?: string;
}): SchedulerJobStatus[];
declare function createStatusStore(api: TuiPluginApi): {
    snapshot: import("solid-js").Accessor<SchedulerStatusSnapshot>;
    loading: import("solid-js").Accessor<boolean>;
    error: import("solid-js").Accessor<string | undefined>;
    refresh: () => Promise<void>;
};
export declare function TaskCenter(props: {
    api: TuiPluginApi;
    store: ReturnType<typeof createStatusStore>;
    returnRoute?: TuiRouteCurrent;
}): import("solid-js").JSX.Element;
export declare function Detail(props: {
    api: TuiPluginApi;
    store: ReturnType<typeof createStatusStore>;
    id?: string;
    returnRoute?: TuiRouteCurrent;
}): import("solid-js").JSX.Element;
declare const tui: TuiPlugin;
export { id, tui };
declare const _default: {
    id: string;
    tui: TuiPlugin;
};
export default _default;
