import { CronExpressionParser } from "cron-parser"
import { existsSync, readdirSync, readFileSync } from "fs"
import { basename, join, resolve as resolvePath } from "path"
import { execFileSync } from "child_process"
import { homedir, platform as osPlatform, userInfo } from "os"

export type SchedulerBackend = "launchd" | "systemd" | "schtasks" | "cron"
export type SchedulerHealth =
  | "healthy"
  | "running"
  | "paused"
  | "disabled"
  | "missing"
  | "drifted"
  | "orphaned"
  | "error"

export interface StoredJob {
  scopeId?: string
  slug: string
  name: string
  schedule: string
  enabled?: boolean
  prompt?: string
  run?: {
    prompt?: string
    command?: string
    arguments?: string
    agent?: string
    model?: string
    [key: string]: unknown
  }
  workdir?: string
  timeoutSeconds?: number
  createdAt: string
  updatedAt?: string
  lastRunAt?: string
  lastRunStatus?: "running" | "success" | "failed"
  lastRunExitCode?: number
  lastRunError?: string
  [key: string]: unknown
}

export interface SchedulerArtifact {
  artifactId: string
  backend: SchedulerBackend
  scopeId?: string
  slug: string
  label: string
  path?: string
  registered: boolean
  enabled: boolean
  running: boolean
  schedule?: string
  nextRunAt?: string
  diagnostics: string[]
}

export interface SchedulerRunRecord {
  runId?: string
  source?: "manual" | "scheduled"
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  status?: string
  exitCode?: number
  error?: string
  logPath?: string
  [key: string]: unknown
}

export interface SchedulerJobStatus {
  id: string
  scopeId: string
  slug: string
  name: string
  enabled: boolean
  health: SchedulerHealth
  backend?: SchedulerBackend
  schedule: string
  scheduleText: string
  timezone: string
  nextRunAt: string | null
  workdir: string
  prompt?: string
  command?: string
  agent?: string
  model?: string
  timeoutSeconds?: number
  lastRunAt?: string
  lastRunStatus?: string
  lastRunExitCode?: number
  lastRunError?: string
  logPath: string
  runHistory: SchedulerRunRecord[]
  artifacts: SchedulerArtifact[]
  diagnostics: string[]
  job: StoredJob
}

export interface SchedulerOrphanStatus {
  id: string
  health: "orphaned" | "error"
  backend: SchedulerBackend
  scopeId?: string
  slug: string
  artifactIds: string[]
  artifacts: SchedulerArtifact[]
  diagnostics: string[]
}

export interface SchedulerStatusSnapshot {
  scannedAt: string
  timezone: string
  jobs: SchedulerJobStatus[]
  orphans: SchedulerOrphanStatus[]
  summary: Record<SchedulerHealth | "total", number>
  diagnostics: string[]
}

export interface StatusPaths {
  configRoot: string
  schedulerRoot: string
  scopesRoot: string
  legacyJobsRoot: string
  logsRoot: string
  launchAgentsRoot: string
  systemdRoot: string
}

export interface StatusDependencies {
  platform: NodeJS.Platform
  paths: StatusPaths
  execFile(command: string, args: string[]): string
}

export interface ScanStatusOptions {
  allScopes?: boolean
  includeLegacy?: boolean
  scopeRoot?: string
  verifySystem?: boolean
  now?: Date
  deps?: Partial<StatusDependencies>
}

function defaultPaths(): StatusPaths {
  const home = homedir()
  const configRoot = join(home, ".config", "opencode")
  return {
    configRoot,
    schedulerRoot: join(configRoot, "scheduler"),
    scopesRoot: join(configRoot, "scheduler", "scopes"),
    legacyJobsRoot: join(configRoot, "jobs"),
    logsRoot: join(configRoot, "logs", "scheduler"),
    launchAgentsRoot: join(home, "Library", "LaunchAgents"),
    systemdRoot: join(home, ".config", "systemd", "user"),
  }
}

function dependencies(overrides?: Partial<StatusDependencies>): StatusDependencies {
  return {
    platform: overrides?.platform ?? osPlatform(),
    paths: overrides?.paths ?? defaultPaths(),
    execFile:
      overrides?.execFile ??
      ((command, args) => execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })),
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of Buffer.from(input, "utf8")) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash
}

export function deriveStatusScopeId(workdir: string): string {
  const normalized = resolvePath(workdir.trim() || homedir())
  const base = slugify(basename(normalized)) || "workspace"
  return `${base}-${fnv1a64(normalized).toString(16).padStart(16, "0").slice(0, 12)}`
}

function listFiles(dir: string, suffix?: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (!suffix || entry.name.endsWith(suffix)))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

function listDirectories(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch {
    return undefined
  }
}

function validJob(value: unknown): value is StoredJob {
  if (!value || typeof value !== "object") return false
  const job = value as Partial<StoredJob>
  return typeof job.slug === "string" && typeof job.name === "string" && typeof job.schedule === "string"
}

function loadJobs(paths: StatusPaths, options: ScanStatusOptions): StoredJob[] {
  const currentScope = deriveStatusScopeId(options.scopeRoot || process.cwd())
  const scopeIds = options.allScopes ? listDirectories(paths.scopesRoot) : [currentScope]
  const jobs: StoredJob[] = []
  for (const scopeId of scopeIds) {
    for (const path of listFiles(join(paths.scopesRoot, scopeId, "jobs"), ".json")) {
      const job = readJson<StoredJob>(path)
      if (validJob(job)) jobs.push({ ...job, scopeId: job.scopeId || scopeId })
    }
  }
  if (options.includeLegacy) {
    for (const path of listFiles(paths.legacyJobsRoot, ".json")) {
      const job = readJson<StoredJob>(path)
      if (validJob(job)) jobs.push({ ...job, scopeId: job.scopeId || deriveStatusScopeId(job.workdir || homedir()) })
    }
  }
  return jobs
}

function parseJobPath(content: string): { scopeId?: string; slug?: string } {
  const scoped = content.match(/scheduler\/scopes\/([^/"'\s]+)\/jobs\/([^/"'\s]+)\.json/)
  if (scoped) return { scopeId: scoped[1], slug: scoped[2] }
  const legacy = content.match(/opencode\/jobs\/([^/"'\s]+)\.json/)
  return legacy ? { slug: legacy[1] } : {}
}

function artifactId(backend: SchedulerBackend, label: string): string {
  return `${backend}:${Buffer.from(label).toString("base64url")}`
}

function scanLaunchd(dep: StatusDependencies): SchedulerArtifact[] {
  const paths = listFiles(dep.paths.launchAgentsRoot, ".plist")
    .filter((path) => basename(path).startsWith("com.opencode.job."))
  const byLabel = new Map<string, string | undefined>(paths.map((path) => [basename(path, ".plist"), path]))
  try {
    const listed = dep.execFile("launchctl", ["list"])
    for (const line of listed.split(/\r?\n/)) {
      const label = line.trim().split(/\s+/).at(-1)
      if (label?.startsWith("com.opencode.job.") && !byLabel.has(label)) byLabel.set(label, undefined)
    }
  } catch {}
  return Array.from(byLabel.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, path]) => {
      const content = path ? readFileSync(path, "utf-8") : ""
      const parsed = parseJobPath(content)
      const labelParts = label.slice("com.opencode.job.".length).split(".")
      const labelScope = labelParts.length > 1 ? labelParts[0] : undefined
      const fallbackSlug = labelParts.length > 1 ? labelParts.slice(1).join(".") : labelParts[0] || label
      let state = ""
      const diagnostics: string[] = []
      try {
        state = dep.execFile("launchctl", ["print", `gui/${userInfo().uid}/${label}`])
      } catch (error) {
        diagnostics.push(`launchctl does not currently report ${label} as loaded`)
      }
      return {
        artifactId: artifactId("launchd", label),
        backend: "launchd" as const,
        scopeId: parsed.scopeId || labelScope,
        slug: parsed.slug || fallbackSlug,
        label,
        path,
        registered: Boolean(state),
        enabled: Boolean(state),
        running: /\bstate\s*=\s*running\b|\bpid\s*=\s*\d+/i.test(state),
        schedule: content.match(/<!--\s*opencode-scheduler-cron:\s*(.*?)\s*-->/)?.[1]?.trim(),
        diagnostics: path ? diagnostics : ["launchd job is loaded but its plist file is missing", ...diagnostics],
      }
    })
}

function systemdIdentity(content: string, fallback: string): { scopeId?: string; slug: string } {
  const parsed = parseJobPath(content)
  if (parsed.slug) return { scopeId: parsed.scopeId, slug: parsed.slug }
  const raw = fallback.replace(/^opencode-job-/, "").replace(/\.(service|timer)$/, "")
  const scoped = raw.match(/^(.+-[0-9a-f]{12})-(.+)$/)
  return scoped ? { scopeId: scoped[1], slug: scoped[2] } : { slug: raw }
}

function scanSystemd(dep: StatusDependencies): SchedulerArtifact[] {
  const timers = listFiles(dep.paths.systemdRoot, ".timer").filter((path) => basename(path).startsWith("opencode-job-"))
  const byLabel = new Map<string, string | undefined>(timers.map((path) => [basename(path), path]))
  try {
    const listed = dep.execFile("systemctl", ["--user", "list-unit-files", "--type=timer", "--no-legend", "--no-pager"])
    for (const line of listed.split(/\r?\n/)) {
      const label = line.trim().split(/\s+/)[0]
      if (label?.startsWith("opencode-job-") && label.endsWith(".timer") && !byLabel.has(label)) byLabel.set(label, undefined)
    }
  } catch {}
  return Array.from(byLabel.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, path]) => {
    const timerContent = path ? readFileSync(path, "utf-8") : ""
    const servicePath = path ? join(dep.paths.systemdRoot, label.replace(/\.timer$/, ".service")) : undefined
    const content = servicePath && existsSync(servicePath) ? readFileSync(servicePath, "utf-8") : timerContent
    const identity = systemdIdentity(content, label)
    const diagnostics: string[] = []
    let enabled = false
    let active = false
    let running = false
    try {
      enabled = dep.execFile("systemctl", ["--user", "is-enabled", label]).trim() === "enabled"
    } catch {
      diagnostics.push(`${label} is not enabled`)
    }
    try {
      active = dep.execFile("systemctl", ["--user", "is-active", label]).trim() === "active"
    } catch {}
    try {
      running = dep.execFile("systemctl", ["--user", "is-active", label.replace(/\.timer$/, ".service")]).trim() === "active"
    } catch {}
    let systemNextRunAt: string | undefined
    try {
      const rawNext = dep.execFile("systemctl", ["--user", "show", label, "--property=NextElapseUSecRealtime", "--value"]).trim()
      const parsedNext = Date.parse(rawNext)
      if (Number.isFinite(parsedNext)) systemNextRunAt = new Date(parsedNext).toISOString()
    } catch {}
    const schedule = timerContent.match(/^#\s*opencode-scheduler-cron:\s*(.+)$/m)?.[1]?.trim()
    return {
      artifactId: artifactId("systemd", label),
      backend: "systemd" as const,
      scopeId: identity.scopeId,
      slug: identity.slug,
      label,
      path,
      registered: active,
      enabled,
      running,
      schedule,
      nextRunAt: systemNextRunAt,
      diagnostics: path ? diagnostics : [`${label} is registered but its timer file is missing`, ...diagnostics],
    }
  })
}

function scanCron(dep: StatusDependencies): SchedulerArtifact[] {
  let content = ""
  try {
    content = dep.execFile("crontab", ["-l"])
  } catch {
    return []
  }
  const regex = /# BEGIN opencode-scheduler ([^\n]+)\n([\s\S]*?)\n# END opencode-scheduler \1/g
  const artifacts: SchedulerArtifact[] = []
  for (const match of content.matchAll(regex)) {
    const key = match[1].trim()
    const body = match[2].trim()
    const separator = key.indexOf(":")
    const scopeId = separator >= 0 && !key.startsWith("legacy:") ? key.slice(0, separator) : undefined
    const slug = separator >= 0 ? key.slice(separator + 1) : key
    artifacts.push({
      artifactId: artifactId("cron", key),
      backend: "cron",
      scopeId,
      slug,
      label: key,
      registered: true,
      enabled: true,
      running: false,
      schedule: body.split(/\s+/).slice(0, 5).join(" "),
      diagnostics: [],
    })
  }
  return artifacts
}

function scanWindows(dep: StatusDependencies): SchedulerArtifact[] {
  const raw = dep.execFile("powershell", [
    "-NoProfile",
    "-Command",
    "Get-ScheduledTask -TaskPath '\\\\OpenCode\\\\' -ErrorAction SilentlyContinue | ForEach-Object { $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue; [pscustomobject]@{ TaskName = $_.TaskName; State = [string]$_.State; NextRunAt = if ($info.NextRunTime -and $info.NextRunTime.Year -gt 1900) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { $null } } } | ConvertTo-Json -Compress",
  ])
  let items: Array<{ TaskName?: string; State?: string; NextRunAt?: string }> = []
  try {
    const parsed = JSON.parse(raw || "[]")
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
  return items.flatMap((item) => {
    if (!item.TaskName?.startsWith("opencode-job-")) return []
    const label = item.TaskName
    const normalized = label.replace(/^opencode-job-/, "")
    const scoped = normalized.match(/^(.+-[0-9a-f]{12})-(.+?)(?:-\d+)?$/)
    const scopeId = scoped?.[1]
    const slug = scoped?.[2] || normalized.replace(/-\d+$/, "")
    return [{
      artifactId: artifactId("schtasks", `\\OpenCode\\${label}`),
      backend: "schtasks" as const,
      scopeId,
      slug,
      label: `\\OpenCode\\${label}`,
      registered: true,
      enabled: item.State !== "Disabled",
      running: item.State === "Running",
      nextRunAt: item.NextRunAt && Number.isFinite(Date.parse(item.NextRunAt)) ? new Date(item.NextRunAt).toISOString() : undefined,
      diagnostics: [],
    }]
  })
}

function scanArtifacts(dep: StatusDependencies): { artifacts: SchedulerArtifact[]; diagnostics: string[] } {
  const diagnostics: string[] = []
  const safe = (backend: SchedulerBackend, fn: () => SchedulerArtifact[]) => {
    try {
      return fn()
    } catch (error) {
      diagnostics.push(`${backend} scan failed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }
  if (dep.platform === "darwin") return { artifacts: safe("launchd", () => scanLaunchd(dep)), diagnostics }
  if (dep.platform === "win32") return { artifacts: safe("schtasks", () => scanWindows(dep)), diagnostics }
  return {
    artifacts: [...safe("systemd", () => scanSystemd(dep)), ...safe("cron", () => scanCron(dep))],
    diagnostics,
  }
}

export function describeSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [minute, hour, dom, month, dow] = parts
  if (month === "*" && dom === "*" && dow === "*" && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return `daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
  }
  if (month === "*" && dom === "*" && dow === "*" && hour.startsWith("*/")) return `every ${hour.slice(2)} hours`
  if (month === "*" && dom === "*" && dow === "*" && minute.startsWith("*/")) return `every ${minute.slice(2)} minutes`
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  if (month === "*" && dom === "*" && /^\d+$/.test(dow) && /^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    return `${days[Number(dow) % 7]} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
  }
  return cron
}

export function nextRunAt(cron: string, now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now, tz: timezone }).next().toISOString()
  } catch {
    return null
  }
}

function lockIsRunning(paths: StatusPaths, scopeId: string, slug: string): boolean {
  const lock = readJson<{ pid?: number }>(join(paths.scopesRoot, scopeId, "locks", `${slug}.json`))
  if (!lock?.pid) return false
  try {
    process.kill(lock.pid, 0)
    return true
  } catch {
    return false
  }
}

export function readRunHistory(paths: StatusPaths, scopeId: string, slug: string, limit = 20): SchedulerRunRecord[] {
  const path = join(paths.scopesRoot, scopeId, "runs", `${slug}.jsonl`)
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SchedulerRunRecord]
        } catch {
          return []
        }
      })
      .slice(-limit)
      .reverse()
  } catch {
    return []
  }
}

function key(scopeId: string | undefined, slug: string): string {
  return `${scopeId || "legacy"}:${slug}`
}

function matchArtifacts(job: StoredJob, artifacts: SchedulerArtifact[]): SchedulerArtifact[] {
  const scopeId = job.scopeId || deriveStatusScopeId(job.workdir || homedir())
  return artifacts.filter((item) => item.slug === job.slug && (item.scopeId === scopeId || item.scopeId === undefined))
}

function healthFor(job: StoredJob, artifacts: SchedulerArtifact[], running: boolean): SchedulerHealth {
  const enabled = job.enabled !== false
  if (!enabled) return artifacts.length ? "drifted" : "paused"
  if (!artifacts.length) return "missing"
  if (running || artifacts.some((item) => item.running)) return "running"
  if (artifacts.some((item) => item.diagnostics.some((message) => /failed|error/i.test(message)))) return "error"
  if (artifacts.some((item) => item.diagnostics.some((message) => /missing/i.test(message)))) return "drifted"
  if (artifacts.some((item) => !item.enabled || !item.registered)) return "disabled"
  if (artifacts.some((item) => item.schedule && item.schedule !== job.schedule)) return "drifted"
  return "healthy"
}

export function scanSchedulerStatus(options: ScanStatusOptions = {}): SchedulerStatusSnapshot {
  const dep = dependencies(options.deps)
  const now = options.now ?? new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const jobs = loadJobs(dep.paths, options)
  const scanned = options.verifySystem === false ? { artifacts: [] as SchedulerArtifact[], diagnostics: [] as string[] } : scanArtifacts(dep)
  const statuses = jobs.map((job): SchedulerJobStatus => {
    const scopeId = job.scopeId || deriveStatusScopeId(job.workdir || homedir())
    const artifacts = options.verifySystem === false ? [] : matchArtifacts(job, scanned.artifacts)
    const running = lockIsRunning(dep.paths, scopeId, job.slug)
    const health = options.verifySystem === false
      ? (job.enabled === false ? "paused" : job.lastRunStatus === "running" ? "running" : "healthy")
      : scanned.diagnostics.length && !artifacts.length
        ? "error"
        : healthFor(job, artifacts, running)
    const diagnostics = [...scanned.diagnostics, ...artifacts.flatMap((item) => item.diagnostics)]
    if (health === "missing") diagnostics.push("Job configuration exists but no matching OS scheduler entry was found")
    if (health === "drifted" && job.enabled === false) diagnostics.push("Paused job still has an OS scheduler entry")
    const enabled = job.enabled !== false
    const logPath = join(dep.paths.logsRoot, scopeId, `${job.slug}.log`)
    return {
      id: key(scopeId, job.slug),
      scopeId,
      slug: job.slug,
      name: job.name,
      enabled,
      health,
      backend: artifacts[0]?.backend,
      schedule: job.schedule,
      scheduleText: describeSchedule(job.schedule),
      timezone,
      nextRunAt: enabled ? artifacts.find((item) => item.nextRunAt)?.nextRunAt || nextRunAt(job.schedule, now, timezone) : null,
      workdir: job.workdir || homedir(),
      prompt: job.run?.prompt || job.prompt,
      command: job.run?.command ? [job.run.command, job.run.arguments].filter(Boolean).join(" ") : undefined,
      agent: job.run?.agent,
      model: job.run?.model,
      timeoutSeconds: job.timeoutSeconds,
      lastRunAt: job.lastRunAt,
      lastRunStatus: job.lastRunStatus,
      lastRunExitCode: job.lastRunExitCode,
      lastRunError: job.lastRunError,
      logPath,
      runHistory: readRunHistory(dep.paths, scopeId, job.slug),
      artifacts,
      diagnostics,
      job,
    }
  })
  const known = new Set(jobs.map((job) => key(job.scopeId || deriveStatusScopeId(job.workdir || homedir()), job.slug)))
  const orphanGroups = new Map<string, SchedulerArtifact[]>()
  for (const artifact of scanned.artifacts) {
    const artifactKey = key(artifact.scopeId, artifact.slug)
    const looseMatch = jobs.some((job) => job.slug === artifact.slug && artifact.scopeId === undefined)
    if (known.has(artifactKey) || looseMatch) continue
    if (!options.allScopes && artifact.scopeId && artifact.scopeId !== deriveStatusScopeId(options.scopeRoot || process.cwd())) continue
    orphanGroups.set(artifactKey, [...(orphanGroups.get(artifactKey) || []), artifact])
  }
  const orphans = Array.from(orphanGroups.entries()).map(([id, artifacts]): SchedulerOrphanStatus => ({
    id,
    health: artifacts.some((item) => item.diagnostics.some((message) => /failed|error/i.test(message))) ? "error" : "orphaned",
    backend: artifacts[0].backend,
    scopeId: artifacts[0].scopeId,
    slug: artifacts[0].slug,
    artifactIds: artifacts.map((item) => item.artifactId),
    artifacts,
    diagnostics: artifacts.flatMap((item) => item.diagnostics),
  }))
  const summary = {
    total: statuses.length + orphans.length,
    healthy: 0,
    running: 0,
    paused: 0,
    disabled: 0,
    missing: 0,
    drifted: 0,
    orphaned: 0,
    error: 0,
  } satisfies SchedulerStatusSnapshot["summary"]
  for (const item of statuses) summary[item.health] += 1
  for (const item of orphans) summary[item.health] += 1
  return { scannedAt: now.toISOString(), timezone, jobs: statuses, orphans, summary, diagnostics: scanned.diagnostics }
}

export function statusPaths(): StatusPaths {
  return defaultPaths()
}
