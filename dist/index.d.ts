/**
 * OpenCode Scheduler Plugin
 *
 * Schedule recurring jobs using launchd (Mac), systemd (Linux), schtasks (Windows), or cron fallback.
 * Jobs are stored under ~/.config/opencode/scheduler/ (scoped by workdir).
 *
 * Features:
 * - Survives reboots
 * - Catches up on missed runs (if computer was asleep)
 * - Cross-platform (Mac + Linux + Windows)
 * - Working directory support for MCP configs
 * - Environment variable injection (PATH for node/npx)
 */
import type { Plugin } from "@opencode-ai/plugin";
import { type SchedulerArtifact, type SchedulerStatusSnapshot } from "./status.js";
type OpencodeRunFormat = "default" | "json";
interface JobRunSpec {
    prompt?: string;
    command?: string;
    arguments?: string;
    files?: string[];
    agent?: string;
    model?: string;
    variant?: string;
    title?: string;
    share?: boolean;
    continue?: boolean;
    session?: string;
    runFormat?: OpencodeRunFormat;
    attachUrl?: string;
    port?: number;
}
type JobInvocation = {
    command: string;
    args: string[];
};
export interface Job {
    scopeId?: string;
    slug: string;
    name: string;
    schedule: string;
    enabled?: boolean;
    prompt?: string;
    attachUrl?: string;
    run?: JobRunSpec;
    invocation?: JobInvocation;
    timeoutSeconds?: number;
    source?: string;
    workdir?: string;
    createdAt: string;
    updatedAt?: string;
    lastRunAt?: string;
    lastRunExitCode?: number;
    lastRunError?: string;
    lastRunSource?: "manual" | "scheduled";
    lastRunStatus?: "running" | "success" | "failed";
}
export interface SchedulerJobLocator {
    id?: string;
    name?: string;
    scopeId?: string;
}
export declare function locateSchedulerJob(locator: SchedulerJobLocator): Job;
export declare function getSchedulerStatus(options?: {
    allScopes?: boolean;
    includeLegacy?: boolean;
    scopeRoot?: string;
    verifySystem?: boolean;
}): SchedulerStatusSnapshot;
export declare function pauseSchedulerJob(locator: SchedulerJobLocator): Job;
export declare function resumeSchedulerJob(locator: SchedulerJobLocator): Job;
export declare function updateSchedulerJobSchedule(locator: SchedulerJobLocator, schedule: string): Job;
export declare function runSchedulerJob(locator: SchedulerJobLocator): {
    startedAt: string;
    logPath: string;
    pid?: number;
    job: Job | null;
};
export declare function deleteSchedulerJob(locator: SchedulerJobLocator): Job;
export declare function schedulerJobLogs(locator: SchedulerJobLocator, lines?: number): {
    job: Job;
    logPath: string;
    logs: string;
};
export declare function removeOrphanArtifact(artifactId: string, confirm?: boolean): {
    dryRun: boolean;
    artifact: SchedulerArtifact;
};
export declare const SchedulerPlugin: Plugin;
export default SchedulerPlugin;
