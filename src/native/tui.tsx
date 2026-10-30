/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable, Renderable } from "@opentui/core"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { createNativeScheduleClient } from "./client.js"
import type { ScheduleRow } from "./model.js"
import { composerRoom } from "./room.js"
import { retainUnchangedRows, retainUnchangedWarnings } from "./snapshot.js"
import { detectLanguage, words } from "./i18n.js"
import { ScheduleWindow, type ScheduleWindowTheme } from "./window.js"

export const id = "opencode-scheduler"

export default Plugin.define({
  id,
  setup(context) {
    const language = detectLanguage()
    const text = words(language)
    const api = createNativeScheduleClient(context.client, language)
    const [open, setOpen] = createSignal(false)
    let windowBox: BoxRenderable | undefined
    /** What had the keyboard before the window opened (the message box); closing gives it back. */
    let focusBefore: Renderable | null = null

    function show() {
      const current = context.ui.router.current()
      if (current.type !== "session") {
        context.ui.toast.show({ variant: "info", title: "Schedules", message: text.sessionRequired })
        return
      }
      if (open()) return hide()
      focusBefore = context.renderer.currentFocusedRenderable
      setOpen(true)
      // The command leaves the message box focused; take the keyboard once it has settled.
      setTimeout(() => windowBox?.focus(), 50)
    }
    function hide() {
      setOpen(false)
      windowBox = undefined
      if (focusBefore && !focusBefore.isDestroyed) focusBefore.focus()
      focusBefore = null
    }

    const theme = (): ScheduleWindowTheme => ({
      text: context.theme.text.base,
      muted: context.theme.text.muted,
      faint: context.theme.text.faint,
      accent: context.theme.text.action.primary.selected,
      background: context.theme.background.base,
      raised: context.theme.background.raised.high,
      border: context.theme.border.base,
      success: context.theme.text.feedback.success.base,
      warning: context.theme.text.feedback.warning.base,
      error: context.theme.text.feedback.error.base,
    })

    function Panel(props: { sessionID: string }) {
      const sessionID = props.sessionID
      const [rows, setRows] = createSignal<ScheduleRow[]>([])
      const [loading, setLoading] = createSignal(false)
      const [error, setError] = createSignal<string>()
      const [warnings, setWarnings] = createSignal<string[]>([])
      const [room, setRoom] = createSignal<number>()
      let scope: "current" | "all" = "current"
      let active: AbortController | undefined
      let disposed = false
      let serial = 0
      let lastGlobalRefresh = 0
      let refreshing = false
      let box: BoxRenderable | undefined

      async function refresh(silent = false) {
        if (disposed) return
        const version = ++serial
        active?.abort()
        active = new AbortController()
        refreshing = true
        setLoading(!silent)
        if (!silent) setError(undefined)
        try {
          const result = await api.list({ scope, sessionID, signal: active.signal })
          if (disposed || version !== serial) return
          setRows((previous) => retainUnchangedRows(previous, result.rows))
          setWarnings((previous) => retainUnchangedWarnings(previous, result.warnings))
          setError(undefined)
          if (scope === "all") lastGlobalRefresh = Date.now()
        } catch (cause) {
          if (!disposed && version === serial) setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          if (!disposed && version === serial) { refreshing = false; setLoading(false) }
        }
      }

      const interval = setInterval(() => {
        // Global fan-out is expensive: refresh it less often, never overlap requests.
        if (!refreshing && (scope === "current" || Date.now() - lastGlobalRefresh >= 60_000)) void refresh(true)
      }, 5_000)

      // Cover the conversation above the message box, never the sidebar or the message box itself.
      const measure = () => {
        if (!box || box.isDestroyed) return
        const next = composerRoom(box)
        if (next !== undefined && next !== room()) queueMicrotask(() => { if (!disposed) setRoom(next) })
      }
      onMount(() => {
        context.renderer.root.on("layout-changed", measure)
        measure()
      })
      onCleanup(() => {
        disposed = true; serial++; active?.abort(); clearInterval(interval)
        context.renderer.root.off("layout-changed", measure)
        if (windowBox === box) windowBox = undefined
      })

      return <ScheduleWindow rows={rows} loading={loading} error={error} warnings={warnings}
        currentSessionID={() => sessionID} theme={theme} refresh={refresh} height={room} language={language}
        onRoot={(element) => {
          box = element
          windowBox = element
          // Drawn again while open (another session, a reconnect): take the keyboard back.
          setTimeout(() => { if (open() && windowBox === element && !element.isDestroyed) element.focus() }, 0)
        }}
        scopeChanged={(next) => { scope = next; setRows([]); void refresh() }}
        pause={async (row) => { await api.pause(row.id); await refresh() }}
        resume={async (row) => {
          const confirmed = await context.ui.dialog.confirm({ title: text.resumeTitle, message: text.resumeMessage })
          if (confirmed && !disposed) { await api.resume(row.id); await refresh() }
        }}
        remove={async (row) => {
          const confirmed = await context.ui.dialog.confirm({ title: text.deleteTitle, message: text.deleteMessage(row.name || row.id, row.session?.title || row.sessionID || "—"), label: { confirm: text.confirmDelete, cancel: text.cancel } })
          if (confirmed && !disposed) { await api.remove(row.id); await refresh() }
        }}
        openSession={(row) => {
          // The window stays open and follows into that conversation.
          if (row.sessionID && row.sessionID !== sessionID) context.ui.router.navigate({ type: "session", sessionID: row.sessionID })
        }}
        close={hide}
        bindKeys={(target, actions) => {
          context.keymap.layer(() => ({ target, priority: 20, commands: actions.map(({ key, run }) => ({ bind: key, run })) }))
          // The host removes the layer when this component is disposed.
          return () => {}
        }} />
    }

    const disposeSlot = context.ui.slot({
      append: "session.composer.top",
      render: (input) => <Show when={open() && input.sessionID} keyed>{(sessionID: string) => <Panel sessionID={sessionID} />}</Show>,
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{ id: "scheduler.open", title: text.commandTitle, group: "Schedules", palette: true,
        slash: { name: "schedule_status" },
        run() {
          context.ui.dialog.clear()
          show()
        },
      }],
    }))
    return () => { disposeSlot() }
  },
})
