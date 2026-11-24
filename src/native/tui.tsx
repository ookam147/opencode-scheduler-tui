/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable, Renderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createAutomationClient } from "./client.js"
import { targetSessionID, type AutomationRow } from "./model.js"
import { composerRoom } from "./room.js"
import { retainUnchangedRows } from "./snapshot.js"
import { LANGUAGE_NAMES, words } from "./i18n.js"
import { FILTERS, LANGUAGES, normalizeSettings, REFRESH_CHOICES, SCOPES, SORTS, TIME_FORMATS, DEFAULT_SETTINGS,
  type SettingKey, type Settings } from "./settings.js"
import { AutomationWindow, type AutomationWindowTheme } from "./window.js"

export const id = "opencode-scheduler"

export default Plugin.define({
  id,
  setup(context) {
    const [stored, update] = context.storage.store<Partial<Settings>>("settings", { initial: { ...DEFAULT_SETTINGS } })
    const settings = () => normalizeSettings(stored)
    const language = () => settings().language
    const text = () => words(language())
    // Session titles come from the host's synced cache, so listing never fans out over sessions.
    const api = createAutomationClient(context.client, (sessionID) => context.data.session.get(sessionID))
    const [open, setOpen] = createSignal(false)
    let windowBox: BoxRenderable | undefined
    /** What had the keyboard before the window opened (the message box); closing gives it back. */
    let focusBefore: Renderable | null = null

    function show() {
      const current = context.ui.router.current()
      if (current.type !== "session") {
        context.ui.toast.show({ variant: "info", title: text().title, message: text().sessionRequired })
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

    const theme = (): AutomationWindowTheme => ({
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
      info: context.theme.text.feedback.info.base,
    })

    /** One setting's choices, labelled in the active language. */
    function choices(key: SettingKey) {
      const t = text()
      switch (key) {
        case "language": return LANGUAGES.map((value) => ({ value, title: LANGUAGE_NAMES[value] }))
        case "refresh": return REFRESH_CHOICES.map((value) => ({ value, title: t.refreshChoice(value) }))
        case "scope": return SCOPES.map((value) => ({ value, title: value === "current" ? t.current : t.allSessions }))
        case "filter": return FILTERS.map((value) => ({ value, title: t.statuses[value] }))
        case "sort": return SORTS.map((value) => ({ value, title: t.sorts[value] }))
        case "time": return TIME_FORMATS.map((value) => ({ value, title: t.timeFormats[value] }))
      }
    }
    const SETTING_KEYS: SettingKey[] = ["language", "refresh", "sort", "time", "scope", "filter"]
    const settingLabel = (key: SettingKey) => ({
      language: text().languageSetting, refresh: text().refreshSetting, scope: text().scopeSetting,
      filter: text().filterSetting, sort: text().sortSetting, time: text().timeSetting,
    })[key]

    /** A list of settings; picking one offers its values, then returns here until dismissed. */
    async function openSettings() {
      let last: SettingKey | undefined
      for (;;) {
        const current = settings()
        const key = await context.ui.dialog.select<SettingKey>({
          title: text().settingsTitle,
          current: last,
          options: SETTING_KEYS.map((item) => ({
            value: item, title: settingLabel(item),
            footer: choices(item).find((choice) => choice.value === current[item])?.title,
          })),
        })
        if (!key) break
        last = key
        const value = await context.ui.dialog.select<Settings[typeof key]>({
          title: settingLabel(key), current: current[key], options: choices(key),
        })
        if (value !== undefined && value !== current[key]) await update((draft) => { (draft as Record<string, unknown>)[key] = value })
      }
      if (open() && windowBox && !windowBox.isDestroyed) windowBox.focus()
    }

    function Panel(props: { sessionID: string }) {
      const sessionID = props.sessionID
      const [rows, setRows] = createSignal<AutomationRow[]>([])
      const [loading, setLoading] = createSignal(false)
      const [error, setError] = createSignal<string>()
      const [room, setRoom] = createSignal<number>()
      let active: AbortController | undefined
      let disposed = false
      let serial = 0
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
          const result = await api.list({ signal: active.signal })
          if (disposed || version !== serial) return
          setRows((previous) => retainUnchangedRows(previous, result))
          setError(undefined)
        } catch (cause) {
          if (!disposed && version === serial) setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          if (!disposed && version === serial) { refreshing = false; setLoading(false) }
        }
      }

      // One request covers both scopes; the window filters locally. Never overlap polls.
      createEffect(() => {
        const seconds = settings().refresh
        if (!seconds) return
        const interval = setInterval(() => { if (!refreshing) void refresh(true) }, seconds * 1_000)
        onCleanup(() => clearInterval(interval))
      })

      // Cover the conversation above the message box, never the sidebar or the message box itself.
      const measure = () => {
        if (!box || box.isDestroyed) return
        const next = composerRoom(box)
        if (next !== undefined && next !== room()) queueMicrotask(() => { if (!disposed) setRoom(next) })
      }
      onMount(() => {
        context.renderer.root.on("layout-changed", measure)
        measure()
        void refresh()
      })
      onCleanup(() => {
        disposed = true; serial++; active?.abort()
        context.renderer.root.off("layout-changed", measure)
        if (windowBox === box) windowBox = undefined
      })

      return <AutomationWindow rows={rows} loading={loading} error={error}
        currentSessionID={() => sessionID} theme={theme} refresh={refresh} height={room} language={language}
        initialScope={settings().scope} initialFilter={settings().filter} openSettings={openSettings}
        sort={() => settings().sort} timeFormat={() => settings().time}
        onRoot={(element) => {
          box = element
          windowBox = element
          // Drawn again while open (another session, a reconnect): take the keyboard back.
          setTimeout(() => { if (open() && windowBox === element && !element.isDestroyed) element.focus() }, 0)
        }}
        pause={async (row) => { await api.pause(row.id); await refresh() }}
        resume={async (row) => {
          const confirmed = await context.ui.dialog.confirm({ title: text().resumeTitle, message: text().resumeMessage })
          if (confirmed && !disposed) { await api.resume(row.id); await refresh() }
        }}
        remove={async (row) => {
          const confirmed = await context.ui.dialog.confirm({ title: text().deleteTitle, message: text().deleteMessage(row.name || row.id, row.session?.title || row.sessionID || "—"), label: { confirm: text().confirmDelete, cancel: text().cancel } })
          if (confirmed && !disposed) { await api.remove(row.id); await refresh() }
        }}
        openSession={(row) => {
          // The window stays open and follows into the conversation the automation prompts.
          const target = targetSessionID(row)
          if (target && target !== sessionID) context.ui.router.navigate({ type: "session", sessionID: target })
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
      commands: [{ id: "scheduler.automation_status", title: text().commandTitle, group: "Automations", palette: true,
        slash: { name: "automation_status" },
        run() {
          context.ui.dialog.clear()
          show()
        },
      }, { id: "scheduler.automation_settings", title: text().settingsCommand, group: "Automations", palette: true,
        run() {
          context.ui.dialog.clear()
          void openSettings()
        },
      }],
    }))
    return () => { disposeSlot() }
  },
})
