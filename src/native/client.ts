import type { OpenCodeClient } from "@opencode/client"
import type { NativeSchedule, ScheduleRow, ScheduleSession } from "./model"

type ScheduleAPI = Pick<OpenCodeClient["experimental"]["schedule"], "list" | "pause" | "resume" | "delete">
export type NativeScheduleClientSource = {
  experimental: { schedule: ScheduleAPI }
  session: Pick<OpenCodeClient["session"], "list" | "get">
}
type ScheduleInfo = Awaited<ReturnType<ScheduleAPI["pause"]>>
type SessionInfo = Awaited<ReturnType<OpenCodeClient["session"]["get"]>>

function toSession(info: SessionInfo): ScheduleSession {
  return {
    id: info.id, title: info.title, directory: info.location.directory,
    agent: info.agent, model: info.model ? { ...info.model } : undefined,
  }
}

function toSchedule(info: ScheduleInfo): NativeSchedule {
  const { action, ...schedule } = info
  // Native timestamps are already milliseconds, including small/zero values.
  return { ...schedule, prompt: action.prompt }
}

/** Also cancel promptly when a transport does not settle on abort. */
function request<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return run()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return run()
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function createNativeScheduleClient(client: NativeScheduleClientSource, language: "zh" | "en" = "zh") {
  const api = client.experimental.schedule
  return {
    async list(options: { scope: "current" | "all"; sessionID?: string; signal?: AbortSignal }): Promise<{
      rows: ScheduleRow[]; warnings: string[]
    }> {
      const { signal } = options
      signal?.throwIfAborted()
      const sessions = new Map<string, ScheduleSession>()
      const warnings: string[] = []
      if (options.scope === "current") {
        if (!options.sessionID) return { rows: [], warnings }
        sessions.set(options.sessionID, { id: options.sessionID })
        try {
          const info = await request(signal, () => client.session.get({ sessionID: options.sessionID! }, { signal }))
          sessions.set(info.id, toSession(info))
        } catch (error) {
          signal?.throwIfAborted()
          warnings.push(language === "zh" ? `会话 ${options.sessionID} 元数据读取失败：${message(error)}`
            : `Could not read session metadata (${options.sessionID}): ${message(error)}`)
        }
      } else {
        let cursor: string | undefined
        const seen = new Set<string>()
        do {
          // No directory or parent filter: walk the complete server session collection.
          const page = await request(signal, () => client.session.list({ cursor, limit: 100 }, { signal }))
          for (const info of page.data) {
            sessions.set(info.id, toSession(info))
          }
          cursor = page.cursor.next ?? undefined
          if (cursor && seen.has(cursor)) throw new Error(language === "zh"
            ? "会话分页游标重复，无法完整列出全部计划" : "Repeated session cursor; cannot list all schedules completely")
          if (cursor) seen.add(cursor)
        } while (cursor)
      }

      const entries = [...sessions.values()]
      const results: ScheduleRow[][] = new Array(entries.length)
      const failures: (string | undefined)[] = new Array(entries.length)
      let next = 0
      async function worker() {
        while (next < entries.length) {
          signal?.throwIfAborted()
          const index = next++
          const session = entries[index]!
          try {
            const schedules = await request(signal, () => api.list({ sessionID: session.id }, { signal }))
            results[index] = schedules.map((info) => ({ ...toSchedule(info), sessionID: info.sessionID ?? session.id, session }))
          } catch (error) {
            signal?.throwIfAborted()
            failures[index] = `${session.title ?? (language === "zh" ? "未命名会话" : "Untitled session")} (${session.id}): ${message(error)}${session.directory ? `\n  ${session.directory}` : ""}`
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker))
      signal?.throwIfAborted()
      const rows = new Map<string, ScheduleRow>()
      for (const group of results) for (const row of group ?? []) if (!rows.has(row.id)) rows.set(row.id, row)
      for (const failure of failures) if (failure) warnings.push(failure)
      return { rows: [...rows.values()], warnings }
    },
    async pause(id: string): Promise<NativeSchedule> {
      return toSchedule(await api.pause({ scheduleID: id }))
    },
    async resume(id: string): Promise<NativeSchedule> {
      return toSchedule(await api.resume({ scheduleID: id }))
    },
    async remove(id: string): Promise<void> {
      await api.delete({ scheduleID: id })
    },
  }
}
