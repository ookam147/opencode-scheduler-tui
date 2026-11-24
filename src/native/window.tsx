/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, KeyEvent, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import { clockTime, columns, fit, nextLabel, relativeTime, STATUS_GLYPHS } from "./format"
import { actionBody, belongsTo, codeWake, countAutomations, selectAutomations, sortAutomations, targetSessionID,
  type AutomationAction, type AutomationFilter, type AutomationSort, type AutomationRow, type AutomationTrigger } from "./model"
import { words, type Language } from "./i18n"
import { FILTERS, SCOPES, type Scope, type TimeFormat } from "./settings"

export type AutomationWindowTheme = Record<
  "text" | "muted" | "accent" | "background" | "raised" | "border" | "success" | "warning" | "error" | "info",
  string | RGBA
> & { faint?: string | RGBA }
export type AutomationWindowProps = {
  language?: Accessor<Language>
  /** Scope and status the window opens with; later changes are the user's. */
  initialScope?: Scope
  initialFilter?: AutomationFilter
  /** List order and how its "Next" column shows times; both follow the settings live. */
  sort?: Accessor<AutomationSort>
  timeFormat?: Accessor<TimeFormat>
  rows: Accessor<AutomationRow[]>
  loading: Accessor<boolean>
  error: Accessor<string | undefined>
  currentSessionID: Accessor<string | undefined>
  theme: Accessor<AutomationWindowTheme>
  refresh(): void | Promise<void>
  pause(row: AutomationRow): void | Promise<void>
  resume(row: AutomationRow): void | Promise<void>
  remove(row: AutomationRow): void | Promise<void>
  openSession(row: AutomationRow): void | Promise<void>
  close(): void | Promise<void>
  /** Rows the window may take; it fills its parent when omitted. */
  height?: Accessor<number | undefined>
  /** The window's own box, for the host to focus and measure. */
  onRoot?(box: BoxRenderable): void
  /** Opens the host's settings dialog; the shortcut is hidden without it. */
  openSettings?(): void | Promise<void>
  bindKeys?(target: () => BoxRenderable | undefined, actions: { key: string; run: () => void }[]): () => void
}

type KeyHint = { key: string; label: string }

/** Status list on the left: indent, label, count and its right border. */
const RAIL_WIDTH = 16
/** Wide enough for the status list beside the task list and the details. */
const WIDE = 110
/** Fits the longest label per language: "59 分钟后" / "in 59 minutes", or "2027-01-02 09:00" as a clock time. */
const NEXT_WIDTH = { relative: { zh: 10, en: 13 }, absolute: { zh: 16, en: 16 } } as const
const WHEN_WIDTH = 20
const LABEL_WIDTH = 8
const HINT_GAP = "  "
/** Longest shown last output; the service already bounds it, but the detail pane redraws on every poll. */
const OUTPUT_LIMIT = 4_000
/** Marks actions that do not simply prompt a session, so they stand out in the list. */
const ACTION_GLYPHS = { shell: "$", code: "λ", subagent: "↳" } as const

/** Keep the same automation through refresh/reordering; otherwise choose its nearest neighbour. */
export function reconcileWindowSelection(rows: AutomationRow[], id: string | undefined, previousIndex = 0) {
  return rows.find((row) => row.id === id)?.id ?? rows[Math.max(0, Math.min(previousIndex, rows.length - 1))]?.id
}

/** Key hints in `width` columns, broken between hints, never inside one. */
export function keyHintLines(hints: KeyHint[], width: number) {
  const lines: KeyHint[][] = []
  let used = 0
  for (const hint of hints) {
    const size = columns(`${hint.key} ${hint.label}`)
    const last = lines.at(-1)
    if (last && used + HINT_GAP.length + size <= width) {
      last.push(hint)
      used += HINT_GAP.length + size
    } else {
      lines.push([hint])
      used = size
    }
  }
  return lines
}

/** A session-native view: every mutation and navigation is delegated to the host. */
export function AutomationWindow(props: AutomationWindowProps) {
  const language = () => props.language?.() ?? "zh"
  const text = () => words(language())
  const describeTrigger = (trigger: AutomationTrigger) => {
    switch (trigger.type) {
      // The service stores `at` as a UTC instant; show it on the local clock like every other time here.
      case "at": { const ms = Date.parse(trigger.at); return text().whenAt(Number.isNaN(ms) ? trigger.at : clockTime(ms, now(), language())) }
      case "every": return text().whenEvery(trigger.every)
      case "cron": return `Cron ${trigger.cron}`
      case "event": return text().whenEvent(trigger.server, trigger.event)
    }
  }
  const terminal = useTerminalDimensions()
  const [width, setWidth] = createSignal(Math.max(20, terminal().width - 4))
  const [filter, setFilter] = createSignal<AutomationFilter>(props.initialFilter ?? "all")
  const [scope, setScope] = createSignal<Scope>(props.currentSessionID() ? props.initialScope ?? "current" : "all")
  const [query, setQuery] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [selectedID, setSelectedID] = createSignal<string>()
  const [pending, setPending] = createSignal(false)
  const [actionError, setActionError] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  const [hasKeyboard, setHasKeyboard] = createSignal(false)
  let root: BoxRenderable | undefined
  let list: ScrollBoxRenderable | undefined
  let detail: ScrollBoxRenderable | undefined
  let previousIndex = 0
  let alive = true
  const theme = props.theme
  const faint = () => theme().faint ?? theme().muted

  const wide = () => width() >= WIDE
  const detailWidth = () => wide() ? Math.min(60, Math.max(40, Math.floor(width() * 0.4))) : width()
  const listWidth = () => wide() ? width() - RAIL_WIDTH - 1 - detailWidth() : width()
  /** Inside the list: its scrollbar column stays free. */
  const rowWidth = () => listWidth() - 2
  const whenWidth = () => rowWidth() >= 56 ? WHEN_WIDTH : 0
  const timeFormat = () => props.timeFormat?.() ?? "relative"
  const nextWidth = () => NEXT_WIDTH[timeFormat()][language()]
  const nameWidth = () => Math.max(6, rowWidth() - 2 - nextWidth() - 2 - (whenWidth() ? whenWidth() + 2 : 0))

  const scoped = createMemo(() => scope() === "all" ? props.rows()
    : props.rows().filter((row) => belongsTo(row, props.currentSessionID())))
  const counts = createMemo(() => countAutomations(scoped()))
  const visible = createMemo(() => sortAutomations(selectAutomations(scoped(), { status: filter(), query: query() }),
    props.sort?.() ?? "created", language() === "zh" ? "zh-CN" : "en"))
  const selected = createMemo(() => visible().find((row) => row.id === selectedID()))
  const busy = () => pending() || props.loading()

  createEffect(() => {
    const rows = visible()
    const id = reconcileWindowSelection(rows, selectedID(), previousIndex)
    if (selectedID() !== id) setSelectedID(id)
    previousIndex = Math.max(0, rows.findIndex((row) => row.id === id))
  })
  createEffect(() => {
    const id = selectedID()
    detail?.scrollTo(0)
    if (id) queueMicrotask(() => { if (alive) list?.scrollChildIntoView(`automation-row-${id}`) })
  })
  const clock = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => { alive = false; clearInterval(clock) })

  async function invoke(action: () => void | Promise<void>) {
    if (busy()) return
    setPending(true)
    setActionError(undefined)
    try { await action() }
    catch (error) { if (alive) setActionError(error instanceof Error ? error.message : String(error)) }
    finally { if (alive) setPending(false) }
  }
  const exitSearch = () => { setSearching(false); root?.focus() }
  const close = () => { Promise.resolve().then(() => props.close()).catch((error) => { if (alive) setActionError(String(error)) }) }
  const escape = () => {
    if (helping()) setHelping(false)
    else if (query()) setQuery("")
    else close()
  }
  const switchFilter = (delta: number) => setFilter(FILTERS[(FILTERS.indexOf(filter()) + delta + FILTERS.length) % FILTERS.length]!)
  function move(delta: number) {
    const rows = visible()
    const index = rows.findIndex((row) => row.id === selectedID())
    setSelectedID(rows[Math.max(0, Math.min(rows.length - 1, index + delta))]?.id)
  }
  function toggle() {
    const row = selected()
    if (row?.status === "active") void invoke(() => props.pause(row))
    if (row?.status === "paused") void invoke(() => props.resume(row))
  }
  const remove = () => { const row = selected(); if (row) void invoke(() => props.remove(row)) }
  const open = () => { const row = selected(); if (row && targetSessionID(row)) void invoke(() => props.openSession(row)) }
  const settings = () => { if (props.openSettings) void invoke(() => props.openSettings!()) }
  const [helping, setHelping] = createSignal(false)
  const toggleHelp = () => { setHelping(!helping()); detail?.scrollTo(0) }
  const actions = [
    { key: "up", run: () => move(-1) }, { key: "k", run: () => move(-1) },
    { key: "down", run: () => move(1) }, { key: "j", run: () => move(1) },
    { key: "left", run: () => switchFilter(-1) }, { key: "right", run: () => switchFilter(1) },
    { key: "tab", run: () => switchFilter(1) }, { key: "shift+tab", run: () => switchFilter(-1) },
    { key: "/", run: () => setSearching(true) },
    { key: "s", run: () => setScope(scope() === "all" ? "current" : "all") },
    { key: "escape", run: escape },
    { key: "r", run: () => { void invoke(props.refresh) } }, { key: "p", run: toggle },
    { key: "d", run: remove }, { key: "o", run: open }, { key: "c", run: settings }, { key: "h", run: toggleHelp },
    { key: "pageup", run: () => detail?.scrollBy(-Math.max(1, detail.height - 1)) },
    { key: "pagedown", run: () => detail?.scrollBy(Math.max(1, detail.height - 1)) },
  ].map((action) => ({ ...action, run: () => { if (!searching()) action.run() } }))

  onMount(() => {
    root?.focus()
    const unbind = props.bindKeys?.(() => searching() ? undefined : root, actions)
    if (unbind) onCleanup(unbind)
  })
  function onKey(key: KeyEvent) {
    if (props.bindKeys || searching() || key.ctrl || key.meta || key.option) return
    const name = key.name === "tab" && key.shift ? "shift+tab" : key.name
    const action = actions.find((action) => action.key === name || (action.key === "/" && key.sequence === "/"))
    if (action) { key.preventDefault(); key.stopPropagation(); action.run() }
  }
  const statusColor = (status: AutomationRow["status"]) =>
    status === "active" ? theme().success : status === "paused" ? theme().warning : theme().muted
  /** The list marker for an action, or nothing for a plain prompt to a session. */
  const actionKind = (action: AutomationAction) =>
    action.type === "prompt" ? action.to.subagent ? "subagent" as const : undefined : action.type
  const actionColor = (action: AutomationAction) => {
    const kind = actionKind(action)
    return kind === "shell" ? theme().warning : kind === "code" ? theme().info : theme().accent
  }
  const pickFilter = (value: AutomationFilter) => { setFilter(value); root?.focus() }
  const title = (row: AutomationRow) => row.name || actionBody(row.action).replace(/\s+/g, " ").trim() || row.id
  const sessionName = (session: AutomationRow["session"]) => session?.title || session?.id

  /** A header tab: raised and bright when chosen, muted otherwise. */
  const Tab = (tab: { label: string; active: boolean; run(): void }) =>
    <text wrapMode="none" selectable={false} flexShrink={0}
      fg={tab.active ? theme().accent : theme().muted} bg={tab.active ? theme().raised : undefined}
      onMouseUp={() => { tab.run(); root?.focus() }}>
      {tab.active ? <b>{` ${tab.label} `}</b> : ` ${tab.label} `}
    </text>

  const Field = (field: { label: string; children: JSX.Element; color?: string | RGBA }) =>
    <text wrapMode="word" flexShrink={0}>
      <span style={{ fg: theme().muted }}>{fit(field.label, language() === "en" ? 11 : LABEL_WIDTH + 2)}</span>
      <span style={{ fg: field.color ?? theme().text }}>{field.children}</span>
    </text>

  const Button = (button: { label: string; hotkey: string; color: string | RGBA; run(): void }) =>
    <text wrapMode="none" selectable={false} flexShrink={0} bg={theme().raised} onMouseUp={button.run}>
      <b style={{ fg: button.color }}>{` ${button.hotkey}`}</b>
      <span style={{ fg: theme().text }}>{` ${button.label} `}</span>
    </text>

  const hints = (): KeyHint[] => {
    if (searching()) return [{ key: "enter", label: text().done }, { key: "esc", label: text().backToList }]
    if (!hasKeyboard()) return [{ key: text().clickWindow, label: text().keyboardElsewhere }, { key: "/automation_status", label: text().close }]
    const row = selected()
    return [
      { key: "↑↓", label: text().select },
      { key: wide() ? "tab" : "←→", label: text().status },
      { key: "s", label: scope() === "all" ? text().onlyCurrent : text().allSessions },
      { key: "/", label: text().search },
      { key: "r", label: text().refresh },
      ...(row?.status === "active" ? [{ key: "p", label: text().pause }] : row?.status === "paused" ? [{ key: "p", label: text().resume }] : []),
      ...(row ? [{ key: "d", label: text().remove }] : []),
      ...(row && targetSessionID(row) ? [{ key: "o", label: text().openSession }] : []),
      ...(props.openSettings ? [{ key: "c", label: text().settings }] : []),
      { key: helping() ? "h/esc" : "h", label: helping() ? text().helpClose : text().help },
      ...(helping() ? [] : [{ key: "esc", label: query() ? text().clearSearch : text().close }]),
    ]
  }

  const notice = (): { text: string; color: string | RGBA } | undefined => {
    const failure = actionError() || props.error()
    if (failure) return { text: `✕ ${failure}`, color: theme().error }
  }

  const emptyText = () => props.loading() ? text().reading
    : props.error() ? text().readFailed
    : scope() === "current" && !props.currentSessionID() ? text().noCurrent
    : query() || filter() !== "all" ? text().noMatches
    : scope() === "current" ? text().noSessionTasks
    : text().noTasks

  const Rail = () =>
    <box width={RAIL_WIDTH} flexShrink={0} flexDirection="column" border={["right"]} borderColor={theme().border}>
      <text fg={faint()} wrapMode="none" flexShrink={0}>{`  ${text().status}`}</text>
      <For each={FILTERS}>{(item) => {
        const chosen = () => filter() === item
        return <text height={1} flexShrink={0} wrapMode="none" selectable={false}
          fg={chosen() ? theme().accent : theme().muted} bg={chosen() ? theme().raised : undefined}
          onMouseUp={() => pickFilter(item)}>
          {`${chosen() ? "›" : " "} ${fit(text().statuses[item], 8)}${fit(String(counts()[item]), RAIL_WIDTH - 12, "right")} `}
        </text>
      }}</For>
    </box>

  const List = () =>
    <box flexDirection="column" width={wide() ? listWidth() : "100%"} height={wide() ? "100%" : "45%"}
      flexShrink={0} minHeight={0} paddingLeft={wide() ? 1 : 0}>
      <text fg={faint()} wrapMode="none" flexShrink={0}>
        {`  ${fit(text().task, nameWidth())}  ${whenWidth() ? `${fit(text().plan, whenWidth())}  ` : ""}${fit(text().next, nextWidth(), "right")}`}
      </text>
      <scrollbox id="automation-list" ref={list} flexGrow={1} flexBasis={0} minHeight={0} scrollX={false}>
        <Show when={visible().length} fallback={<text fg={theme().muted} wrapMode="word" marginTop={1}>{`  ${emptyText()}`}</text>}>
          <For each={visible()}>{(row) => {
            const chosen = () => selectedID() === row.id
            /** Keeps the row's total width stable, so the action marker never shifts the columns beside it. */
            const marker = () => { const kind = actionKind(row.action); return kind ? `${ACTION_GLYPHS[kind]} ` : "" }
            /** The last run failed (an active retry, or the reason it paused); say so without opening the details. */
            const failed = () => row.status !== "done" && row.lastOutcome === "failed" ? ` ${text().failedTag}` : ""
            const room = () => nameWidth() - columns(marker()) - columns(failed())
            /** Unpadded, so the failure tag follows the name; the padding goes after the tag instead. */
            const name = () => fit(title(row), room()).trimEnd()
            const pad = () => " ".repeat(Math.max(0, room() - columns(name())))
            return <box id={`automation-row-${row.id}`} height={1} flexShrink={0}
              backgroundColor={chosen() ? theme().raised : undefined}
              onMouseUp={() => { setSelectedID(row.id); root?.focus() }}>
              <text wrapMode="none" selectable={false}>
                <span style={{ fg: statusColor(row.status) }}>{`${STATUS_GLYPHS[row.status]} `}</span>
                <span style={{ fg: actionColor(row.action) }}>{marker()}</span>
                {chosen()
                  ? <b style={{ fg: theme().accent }}>{name()}</b>
                  : <span style={{ fg: row.status === "done" ? theme().muted : theme().text }}>{name()}</span>}
                <span style={{ fg: theme().error }}>{failed()}</span>
                <span style={{ fg: theme().muted }}>{pad()}</span>
                <span style={{ fg: theme().muted }}>{whenWidth() ? `  ${fit(describeTrigger(row.trigger), whenWidth())}` : ""}</span>
                <span style={{ fg: row.status === "active" ? theme().text : faint() }}>{`  ${fit(nextLabel(row, now(), language(), timeFormat()), nextWidth(), "right")}`}</span>
              </text>
            </box>
          }}</For>
        </Show>
      </scrollbox>
    </box>

  const output = (value: string) => value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}…` : value

  /** Replaces the details while open, so explanations never sit among a task's own content. */
  const Help = () => {
    const keyWidth = () => Math.max(...text().helpSections.flatMap((section) => section.items.map(([key]) => columns(key)))) + 2
    return <box id="automation-help" flexDirection="column" flexShrink={0}>
      <text fg={theme().text} flexShrink={0}><b>{text().helpTitle}</b></text>
      <For each={text().helpSections}>{(section) =>
        <>
          <box height={1} flexShrink={0} />
          <text fg={theme().muted} flexShrink={0}>{section.title}</text>
          <For each={section.items}>{([key, value]) =>
            <box flexDirection="row" flexShrink={0}>
              <text fg={theme().accent} wrapMode="none" flexShrink={0} width={keyWidth()}>{key}</text>
              <text fg={theme().text} wrapMode="word" flexGrow={1} flexShrink={1} minWidth={0}>{value}</text>
            </box>}
          </For>
        </>}
      </For>
    </box>
  }

  const Detail = (detailProps: { row: AutomationRow }) => {
    const row = () => detailProps.row
    const action = () => row().action
    /** Only a prompt to another session needs saying; a subagent is named beside the action. */
    const sendTo = () => {
      const current = action()
      if (current.type !== "prompt" || current.to.subagent || current.to.session === row().sessionID) return undefined
      return sessionName(row().target) || current.to.session
    }
    const subagent = () => { const current = action(); return current.type === "prompt" ? current.to.subagent : undefined }
    const eventArgs = () => {
      const trigger = row().trigger
      return trigger.type === "event" && trigger.args && Object.keys(trigger.args).length ? JSON.stringify(trigger.args) : undefined
    }
    const wake = () => { const value = codeWake(row()); return value ? ` · ${text().wakes[value]}` : "" }
    const state = () => {
      const value = row().state
      return value === undefined || value === null ? undefined : JSON.stringify(value, null, 2)
    }
    return <box flexDirection="column" flexShrink={0}>
      <text fg={theme().text} wrapMode="word" flexShrink={0}><b>{title(row())}</b></text>
      <text wrapMode="none" flexShrink={0}>
        <span style={{ fg: statusColor(row().status) }}>{`${STATUS_GLYPHS[row().status]} ${text().statuses[row().status]}`}</span>
        <span style={{ fg: faint() }}>{`  ·  ${describeTrigger(row().trigger)}`}</span>
      </text>
      <box height={1} flexShrink={0} />
      <Field label={text().next}>{row().status === "active" && row().nextDueAt !== undefined
        ? text().nextTime(clockTime(row().nextDueAt, now(), language()), relativeTime(row().nextDueAt, now(), language()))
        : row().status === "paused" ? text().pausedNext : row().status === "done" ? text().noMoreRuns
        : row().trigger.type === "event" ? text().onEvent : "—"}</Field>
      <Show when={eventArgs()}>{(args) => <Field label={text().eventArgs}>{args()}</Field>}</Show>
      <Field label={text().timeZone}>{row().tz}</Field>
      <Field label={text().ends}>{row().expires !== undefined ? clockTime(row().expires, now(), language()) : text().unlimited}</Field>
      <Field label={text().runs}>{text().runCount(row().runCount)}</Field>
      <Field label={text().last} color={row().lastOutcome === "failed" ? theme().error : undefined}>
        {row().lastRunAt !== undefined
          ? `${clockTime(row().lastRunAt, now(), language())}${row().lastOutcome ? ` · ${text().outcomes[row().lastOutcome!]}` : ""}${wake()}`
          : row().lastOutcome ? `${text().outcomes[row().lastOutcome!]}${wake()}` : text().neverFired}
      </Field>
      <box height={1} flexShrink={0} />
      <text flexShrink={0}>
        <span style={{ fg: theme().muted }}>{`${text().action}  `}</span>
        <span style={{ fg: actionColor(action()) }}>{text().actions[actionKind(action()) ?? "prompt"]}</span>
        <Show when={subagent()}>{(agent) => <span style={{ fg: theme().text }}>{` ${agent()}`}</span>}</Show>
      </text>
      <box flexShrink={0} border={["left"]} borderColor={actionColor(action())} paddingLeft={1} marginTop={0}>
        <text fg={theme().text} wrapMode="word">{actionBody(action()).trim() || "—"}</text>
      </box>
      <Show when={sendTo()}>{(value) => <Field label={text().sendTo}>{value()}</Field>}</Show>
      <Show when={row().lastOutput}>{(value) =>
        <>
          <box height={1} flexShrink={0} />
          <text fg={theme().muted} flexShrink={0}>{text().lastOutput}</text>
          <box flexShrink={0} border={["left"]} borderColor={row().lastOutcome === "failed" ? theme().error : theme().border} paddingLeft={1}>
            <text fg={row().lastOutcome === "failed" ? theme().error : faint()} wrapMode="word">{output(value())}</text>
          </box>
        </>}
      </Show>
      <Show when={state()}>{(value) =>
        <>
          <box height={1} flexShrink={0} />
          <text fg={theme().muted} flexShrink={0}>{text().savedState}</text>
          <box flexShrink={0} border={["left"]} borderColor={theme().border} paddingLeft={1}>
            <text fg={faint()} wrapMode="word">{output(value())}</text>
          </box>
        </>}
      </Show>
      <box height={1} flexShrink={0} />
      <text fg={theme().muted} flexShrink={0}>{text().session}</text>
      <text fg={theme().text} wrapMode="word" flexShrink={0}>{sessionName(row().session) || text().unknownSession}</text>
      <text fg={faint()} wrapMode="word" flexShrink={0}>{row().directory}</text>
      <box height={1} flexShrink={0} />
      <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
        <Show when={row().status !== "done"}>
          <Button hotkey="p" label={row().status === "active" ? text().pause : text().resume} color={theme().warning} run={toggle} />
        </Show>
        <Button hotkey="d" label={text().remove} color={theme().error} run={remove} />
        <Show when={targetSessionID(row())}><Button hotkey="o" label={text().openSession} color={theme().accent} run={open} /></Show>
      </box>
      <box height={1} flexShrink={0} />
      <text fg={faint()} wrapMode="word" flexShrink={0}>{`${text().automationID}: ${row().id}`}</text>
      <text fg={faint()} wrapMode="word" flexShrink={0}>{`${text().sessionID}: ${row().sessionID || "—"}`}</text>
    </box>
  }

  return <box
    id="native-automation-window" focusable flexDirection="column" flexShrink={0}
    ref={(box: BoxRenderable) => {
      root = box
      box.on("focused", () => setHasKeyboard(true))
      box.on("blurred", () => setHasKeyboard(false))
      props.onRoot?.(box)
    }}
    width="100%" height={props.height ? props.height() ?? 20 : "100%"} overflow="hidden"
    border borderStyle="rounded" borderColor={hasKeyboard() ? theme().accent : theme().border}
    paddingLeft={1} paddingRight={1} onKeyDown={onKey}
    onSizeChange={function (this: BoxRenderable) { const measured = this.width - 4; if (measured > 0 && measured !== width()) queueMicrotask(() => { if (alive) setWidth(measured) }) }}
    onMouseDown={() => { if (!searching()) root?.focus() }}
  >
    <box flexDirection="row" flexShrink={0} height={1} gap={1}>
      <text fg={theme().text} wrapMode="none" flexShrink={0} marginRight={1}><b>{text().title}</b></text>
      <For each={SCOPES}>{(item) => <Tab label={item === "current" ? (language() === "en" && !wide() ? "Current" : text().current) : text().allSessions} active={scope() === item} run={() => setScope(item)} />}</For>
      <box flexGrow={1} />
      <Show when={busy()}><text fg={theme().muted} flexShrink={0}>{props.loading() ? text().refreshing : text().processing}</text></Show>
      <text fg={theme().muted} flexShrink={0} selectable={false} onMouseUp={close}>esc</text>
    </box>
    <Show when={!wide()}>
      <box flexDirection="row" flexShrink={0} height={1}>
        <For each={FILTERS}>{(item) => <Tab label={`${text().statuses[item]} ${counts()[item]}`} active={filter() === item} run={() => pickFilter(item)} />}</For>
      </box>
    </Show>
    <Show when={searching() || query()}>
      <box id="automation-search-box" flexDirection="row" height={1} flexShrink={0} marginTop={1} onMouseUp={() => setSearching(true)}>
        <text fg={theme().accent} flexShrink={0}>{"/ "}</text>
        <Show when={searching()} fallback={<text fg={theme().text} wrapMode="none">{query()}</text>}>
          <input id="automation-search" flexGrow={1} value={query()} onInput={setQuery} focused={searching()}
            placeholder={text().searchPlaceholder} textColor={theme().text} backgroundColor={theme().raised}
            onKeyDown={(key) => {
              // An input owns all character keys. Escape/Enter only leave the input, never close the window.
              if (["escape", "return", "enter", "tab"].includes(key.name)) {
                key.preventDefault(); key.stopPropagation(); exitSearch()
              }
            }} />
        </Show>
      </box>
    </Show>
    <Show when={notice()}>{(item) =>
      <text flexShrink={0} height={1} marginTop={1} fg={item().color} wrapMode="none" selectable={false}>
        {fit(item().text, width())}
      </text>}
    </Show>
    <box flexDirection={wide() ? "row" : "column"} flexGrow={1} flexBasis={0} minHeight={0} marginTop={1} overflow="hidden">
      <Show when={wide()}><Rail /></Show>
      <List />
      <scrollbox id="automation-detail" ref={detail} flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} scrollX={false}
        border={wide() ? ["left"] : ["top"]} borderColor={theme().border} paddingLeft={wide() ? 2 : 0} paddingRight={1}>
        <Show when={!helping()} fallback={<Help />}>
          <Show when={selected()} fallback={<text fg={faint()} wrapMode="word">{visible().length ? text().selectTask : ""}</text>}>
            {(row) => <Detail row={row()} />}
          </Show>
        </Show>
      </scrollbox>
    </box>
    <box id="automation-footer" flexDirection="column" flexShrink={0} marginTop={1}>
      <For each={keyHintLines(hints(), width())}>{(line) =>
        <text wrapMode="none" selectable={false}>
          {line.flatMap((hint, index) => [
            ...(index ? [<span style={{ fg: theme().muted }}>{HINT_GAP}</span>] : []),
            <b style={{ fg: theme().text }}>{hint.key}</b>,
            <span style={{ fg: theme().muted }}>{` ${hint.label}`}</span>,
          ])}
        </text>}
      </For>
    </box>
  </box>
}
