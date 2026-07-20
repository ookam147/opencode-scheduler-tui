export type SchedulerBackend = "launchd" | "systemd" | "schtasks" | "cron";
export type SchedulerHealth = "healthy" | "running" | "paused" | "disabled" | "missing" | "drifted" | "orphaned" | "error";
export interface StoredJob {
    scopeId?: string;
    slug: string;
    name: string;
    schedule: string;
    enabled?: boolean;
    prompt?: string;
    run?: {
        prompt?: string;
        command?: string;
        arguments?: string;
        agent?: string;
        model?: string;
        [key: string]: unknown;
    };
    workdir?: string;
    timeoutSeconds?: number;
    createdAt: string;
    updatedAt?: string;
    lastRunAt?: string;
    lastRunStatus?: "running" | "success" | "failed";
    lastRunExitCode?: number;
    lastRunError?: string;
    [key: string]: unknown;
}
export interface SchedulerArtifact {
    artifactId: string;
    backend: SchedulerBackend;
    scopeId?: string;
    slug: string;
    label: string;
    path?: string;
    registered: boolean;
    enabled: boolean;
    running: boolean;
    schedule?: string;
    nextRunAt?: string;
    diagnostics: string[];
}
export interface SchedulerRunRecord {
    runId?: string;
    source?: "manual" | "scheduled";
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    status?: string;
    exitCode?: number;
    error?: string;
    logPath?: string;
    [key: string]: unknown;
}
export interface SchedulerJobStatus {
    id: string;
    scopeId: string;
    slug: string;
    name: string;
    enabled: boolean;
    health: SchedulerHealth;
    backend?: SchedulerBackend;
    schedule: string;
    scheduleText: string;
    timezone: string;
    nextRunAt: string | null;
    workdir: string;
    prompt?: string;
    command?: string;
    agent?: string;
    model?: string;
    timeoutSeconds?: number;
    lastRunAt?: string;
    lastRunStatus?: string;
    lastRunExitCode?: number;
    lastRunError?: string;
    logPath: string;
    runHistory: SchedulerRunRecord[];
    artifacts: SchedulerArtifact[];
    diagnostics: string[];
    job: StoredJob;
}
export interface SchedulerOrphanStatus {
    id: string;
    health: "orphaned" | "error";
    backend: SchedulerBackend;
    scopeId?: string;
    slug: string;
    artifactIds: string[];
    artifacts: SchedulerArtifact[];
    diagnostics: string[];
}
export interface SchedulerStatusSnapshot {
    scannedAt: string;
    timezone: string;
    jobs: SchedulerJobStatus[];
    orphans: SchedulerOrphanStatus[];
    summary: Record<SchedulerHealth | "total", number>;
    diagnostics: string[];
}
export interface StatusPaths {
    configRoot: string;
    schedulerRoot: string;
    scopesRoot: string;
    legacyJobsRoot: string;
    logsRoot: string;
    launchAgentsRoot: string;
    systemdRoot: string;
}
export interface StatusDependencies {
    platform: NodeJS.Platform;
    paths: StatusPaths;
    execFile(command: string, args: string[]): string;
}
export interface ScanStatusOptions {
    allScopes?: boolean;
    includeLegacy?: boolean;
    scopeRoot?: string;
    verifySystem?: boolean;
    now?: Date;
    deps?: Partial<StatusDependencies>;
}
export declare function deriveStatusScopeId(workdir: string): string;
export declare function describeSchedule(cron: string): string;
export declare function nextRunAt(cron: string, now?: Date, timezone?: string): string | null;
export declare function readRunHistory(paths: StatusPaths, scopeId: string, slug: string, limit?: number): SchedulerRunRecord[];
export declare function scanSchedulerStatus(options?: ScanStatusOptions): SchedulerStatusSnapshot;
export declare function statusPaths(): StatusPaths;
