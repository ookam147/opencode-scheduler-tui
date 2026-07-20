import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui";
import type { Accessor, JSX } from "solid-js";
import { type SchedulerJobStatus, type SchedulerStatusSnapshot } from "./status.js";
declare const id = "opencode-scheduler";
export type Filter = "all" | "active" | "paused" | "problems";
export type ScopeMode = "all" | "current";
export type SchedulerCenterState = {
    scope?: ScopeMode;
    filter?: Filter;
    query?: string;
    selectedId?: string;
};
type SchedulerRouteParams = {
    id?: string;
    entry?: "sidebar" | "center" | "command";
    returnRoute?: TuiRouteCurrent;
    centerState?: SchedulerCenterState;
};
export declare function filterSchedulerJobs(jobs: SchedulerJobStatus[], options: {
    query?: string;
    filter?: Filter;
    scopeId?: string;
}): SchedulerJobStatus[];
export type StatusStoreOptions = {
    schedulerRoot?: string;
    loadStatus?: () => SchedulerStatusSnapshot;
    debounceMs?: number;
    fallbackMs?: number;
    verificationMs?: number;
};
export type StatusStore = {
    snapshot: Accessor<SchedulerStatusSnapshot>;
    loading: Accessor<boolean>;
    error: Accessor<string | undefined>;
    refresh: () => Promise<void>;
    scheduleRefresh: () => void;
};
export declare function createStatusStore(api: TuiPluginApi, options?: StatusStoreOptions): StatusStore;
export declare function Sidebar(props: {
    api: TuiPluginApi;
    store: StatusStore;
}): JSX.Element;
export declare function TaskCenter(props: {
    api: TuiPluginApi;
    store: StatusStore;
    returnRoute?: TuiRouteCurrent;
    initialState?: SchedulerCenterState;
}): JSX.Element;
export declare function Detail(props: {
    api: TuiPluginApi;
    store: StatusStore;
    id?: string;
    entry?: SchedulerRouteParams["entry"];
    returnRoute?: TuiRouteCurrent;
    centerState?: SchedulerCenterState;
}): JSX.Element;
declare const tui: TuiPlugin;
export { id, tui };
declare const _default: {
    id: string;
    tui: TuiPlugin;
};
export default _default;
