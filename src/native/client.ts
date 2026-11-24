import type { OpenCodeClient } from "@opencode/client"
import { targetSessionID, type Automation, type AutomationRow, type AutomationSession } from "./model"

type AutomationAPI = Pick<OpenCodeClient["experimental"]["automation"], "list" | "pause" | "resume" | "delete">
export type AutomationClientSource = { experimental: { automation: AutomationAPI } }
type AutomationInfo = Awaited<ReturnType<AutomationAPI["pause"]>>
/** Reads a session the host already holds; the window never fetches sessions itself. */
export type SessionLookup = (sessionID: string) => { id: string; title?: string } | undefined

function toAutomation(info: AutomationInfo): Automation {
  // Native timestamps are already milliseconds, including small/zero values.
  return info as Automation
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

export function createAutomationClient(client: AutomationClientSource, lookup: SessionLookup = () => undefined) {
  const api = client.experimental.automation
  const session = (id: string | undefined): AutomationSession | undefined => {
    if (!id) return undefined
    const info = lookup(id)
    return { id, ...(info?.title ? { title: info.title } : {}) }
  }
  return {
    /** Every automation the server lets this client see, oldest first, in one request. */
    async list(options: { signal?: AbortSignal } = {}): Promise<AutomationRow[]> {
      const { signal } = options
      const rows = await request(signal, () => api.list(undefined, { signal }))
      signal?.throwIfAborted()
      return rows.map((info) => {
        const row = toAutomation(info)
        const target = targetSessionID(row)
        return { ...row, session: session(row.sessionID), ...(target !== row.sessionID ? { target: session(target) } : {}) }
      })
    },
    async pause(id: string): Promise<Automation> {
      return toAutomation(await api.pause({ automationID: id }))
    },
    async resume(id: string): Promise<Automation> {
      return toAutomation(await api.resume({ automationID: id }))
    },
    async remove(id: string): Promise<void> {
      await api.delete({ automationID: id })
    },
  }
}
