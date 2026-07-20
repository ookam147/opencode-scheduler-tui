import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { deriveStatusScopeId, nextRunAt, scanSchedulerStatus, type StatusPaths } from "./status"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; paths: StatusPaths } {
  const root = mkdtempSync(join(tmpdir(), "opencode-scheduler-test-"))
  roots.push(root)
  const configRoot = join(root, ".config", "opencode")
  const paths = {
    configRoot,
    schedulerRoot: join(configRoot, "scheduler"),
    scopesRoot: join(configRoot, "scheduler", "scopes"),
    legacyJobsRoot: join(configRoot, "jobs"),
    logsRoot: join(configRoot, "logs", "scheduler"),
    launchAgentsRoot: join(root, "Library", "LaunchAgents"),
    systemdRoot: join(root, ".config", "systemd", "user"),
  }
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true })
  return { root, paths }
}

function saveJob(paths: StatusPaths, workdir: string, slug: string, extra: Record<string, unknown> = {}) {
  const scopeId = deriveStatusScopeId(workdir)
  const dir = join(paths.scopesRoot, scopeId, "jobs")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify({
    scopeId,
    slug,
    name: slug,
    schedule: "0 9 * * *",
    prompt: "test",
    workdir,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }))
  return scopeId
}

describe("scheduler status reconciliation", () => {
  test("reports a loaded matching launchd task as healthy", () => {
    const { root, paths } = fixture()
    const workdir = join(root, "project")
    const scopeId = saveJob(paths, workdir, "daily")
    const label = `com.opencode.job.${scopeId}.daily`
    writeFileSync(join(paths.launchAgentsRoot, `${label}.plist`), `
      <!-- opencode-scheduler-cron: 0 9 * * * -->
      <string>${paths.scopesRoot}/${scopeId}/jobs/daily.json</string>
    `)
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: { platform: "darwin", paths, execFile: () => "state = waiting" },
    })
    expect(snapshot.jobs).toHaveLength(1)
    expect(snapshot.jobs[0].health).toBe("healthy")
    expect(snapshot.jobs[0].backend).toBe("launchd")
    expect(snapshot.orphans).toHaveLength(0)
  })

  test("detects Issue #20 style launchd orphan", () => {
    const { paths } = fixture()
    const scopeId = "ghost-123456789abc"
    const label = `com.opencode.job.${scopeId}.ghost`
    writeFileSync(join(paths.launchAgentsRoot, `${label}.plist`), `
      <!-- opencode-scheduler-cron: */5 * * * * -->
      <string>${paths.scopesRoot}/${scopeId}/jobs/ghost.json</string>
    `)
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: { platform: "darwin", paths, execFile: () => "state = waiting" },
    })
    expect(snapshot.jobs).toHaveLength(0)
    expect(snapshot.orphans).toHaveLength(1)
    expect(snapshot.orphans[0].slug).toBe("ghost")
    expect(snapshot.orphans[0].artifactIds[0]).toStartWith("launchd:")
  })

  test("detects a loaded launchd orphan even when its plist was already deleted", () => {
    const { paths } = fixture()
    const label = "com.opencode.job.ghost-123456789abc.loaded-only"
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: {
        platform: "darwin",
        paths,
        execFile: (_command, args) => args[0] === "list" ? `-\t0\t${label}` : "state = waiting",
      },
    })
    expect(snapshot.jobs).toHaveLength(0)
    expect(snapshot.orphans).toHaveLength(1)
    expect(snapshot.orphans[0].slug).toBe("loaded-only")
    expect(snapshot.orphans[0].diagnostics).toContain("launchd job is loaded but its plist file is missing")
  })

  test("distinguishes paused, missing, disabled, drifted, and running", () => {
    const { root, paths } = fixture()
    const workdir = join(root, "project")
    const scopeId = saveJob(paths, workdir, "paused", { enabled: false })
    saveJob(paths, workdir, "missing")
    saveJob(paths, workdir, "disabled")
    saveJob(paths, workdir, "drifted")
    saveJob(paths, workdir, "running")
    for (const [slug, schedule] of [["disabled", "0 9 * * *"], ["drifted", "0 10 * * *"], ["running", "0 9 * * *"]]) {
      const label = `com.opencode.job.${scopeId}.${slug}`
      writeFileSync(join(paths.launchAgentsRoot, `${label}.plist`), `<!-- opencode-scheduler-cron: ${schedule} --><string>${paths.scopesRoot}/${scopeId}/jobs/${slug}.json</string>`)
    }
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: {
        platform: "darwin",
        paths,
        execFile: (_command, args) => {
          const label = args.at(-1) || ""
          if (label.endsWith("disabled")) throw new Error("not loaded")
          if (label.endsWith("running")) return "state = running\npid = 123"
          return "state = waiting"
        },
      },
    })
    expect(Object.fromEntries(snapshot.jobs.map((job) => [job.slug, job.health]))).toEqual({
      paused: "paused",
      missing: "missing",
      disabled: "disabled",
      drifted: "drifted",
      running: "running",
    })
  })

  test("reads systemd and cron without confusing same-scope jobs", () => {
    const { root, paths } = fixture()
    const workdir = join(root, "project")
    const scopeId = saveJob(paths, workdir, "timer")
    saveJob(paths, workdir, "cron")
    writeFileSync(join(paths.systemdRoot, `opencode-job-${scopeId}-timer.timer`), `# opencode-scheduler-cron: 0 9 * * *\n[Timer]\n`)
    writeFileSync(join(paths.systemdRoot, `opencode-job-${scopeId}-timer.service`), `ExecStart=/usr/bin/perl ${paths.scopesRoot}/${scopeId}/jobs/timer.json`)
    const crontab = `# BEGIN opencode-scheduler ${scopeId}:cron\n0 9 * * * echo ok\n# END opencode-scheduler ${scopeId}:cron\n`
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: {
        platform: "linux",
        paths,
        execFile: (command, args) => {
          if (command === "crontab") return crontab
          if (args.includes("is-enabled")) return "enabled"
          if (args.includes("show")) return "2026-07-20T12:34:00.000Z"
          return args.at(-1)?.endsWith(".service") ? "inactive" : "active"
        },
      },
    })
    expect(snapshot.jobs.map((job) => [job.slug, job.health, job.backend])).toEqual([
      ["cron", "healthy", "cron"],
      ["timer", "healthy", "systemd"],
    ])
    expect(snapshot.jobs.find((job) => job.slug === "timer")?.nextRunAt).toBe("2026-07-20T12:34:00.000Z")
  })

  test("reads Windows Task Scheduler state and authoritative next run", () => {
    const { root, paths } = fixture()
    const workdir = join(root, "windows-project")
    const scopeId = saveJob(paths, workdir, "daily-sync")
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: {
        platform: "win32",
        paths,
        execFile: () => JSON.stringify({
          TaskName: `opencode-job-${scopeId}-daily-sync`,
          State: "Disabled",
          NextRunAt: "2026-07-21T01:00:00.000Z",
        }),
      },
    })
    expect(snapshot.jobs).toHaveLength(1)
    expect(snapshot.jobs[0].backend).toBe("schtasks")
    expect(snapshot.jobs[0].health).toBe("disabled")
    expect(snapshot.jobs[0].nextRunAt).toBe("2026-07-21T01:00:00.000Z")
  })

  test("reports an OS scheduler scan failure as an error instead of a missing task", () => {
    const { root, paths } = fixture()
    saveJob(paths, join(root, "windows-project"), "unverified")
    const snapshot = scanSchedulerStatus({
      allScopes: true,
      verifySystem: true,
      deps: { platform: "win32", paths, execFile: () => { throw new Error("PowerShell unavailable") } },
    })
    expect(snapshot.jobs[0].health).toBe("error")
    expect(snapshot.jobs[0].diagnostics.join(" ")).toContain("PowerShell unavailable")
  })
})

describe("nextRunAt", () => {
  const now = new Date("2026-07-20T00:00:00.000Z")

  test("handles daily and stepped schedules", () => {
    expect(nextRunAt("0 9 * * *", now, "UTC")).toBe("2026-07-20T09:00:00.000Z")
    expect(nextRunAt("*/15 * * * *", now, "UTC")).toBe("2026-07-20T00:15:00.000Z")
  })

  test("preserves cron day-of-month/day-of-week OR semantics", () => {
    expect(nextRunAt("0 9 21 * 2", now, "UTC")).toBe("2026-07-21T09:00:00.000Z")
  })

  test("handles weekday, month-day, and timezone schedules", () => {
    expect(nextRunAt("0 10 * * 2", now, "UTC")).toBe("2026-07-21T10:00:00.000Z")
    expect(nextRunAt("0 8 1 * *", now, "UTC")).toBe("2026-08-01T08:00:00.000Z")
    expect(nextRunAt("0 9 * * *", now, "Asia/Shanghai")).toBe("2026-07-20T01:00:00.000Z")
  })

  test("returns null for invalid input", () => {
    expect(nextRunAt("not cron", now, "UTC")).toBeNull()
  })
})
