/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, KeyEvent, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import { clockTime, columns, fit, nextLabel, relativeTime, STATUS_GLYPHS } from "./format"
import { countSchedules, scheduleCheck, selectSchedules,
  type ScheduleCondition, type ScheduleFilter, type ScheduleRow, type ScheduleWhen } from "./model"
import { detectLanguage, words, type Language } from "./i18n"

export type ScheduleWindowTheme = Record<
  "text" | "muted" | "accent" | "background" | "raised" | "border" | "success" | "warning" | "error",
  string | RGBA
> & { faint?: string | RGBA }
export type ScheduleWindowProps = {
  language?: Language
  rows: Accessor<ScheduleRow[]>
  loading: Accessor<boolean>
  error: Accessor<string | undefined>
  /** Sessions whose schedules could not be read; the rest of the list is still shown. */
  warnings?: Accessor<string[]>
  currentSessionID: Accessor<string | undefined>
  theme: Accessor<ScheduleWindowTheme>
  refresh(): void | Promise<void>
  pause(row: ScheduleRow): void | Promise<void>
  resume(row: ScheduleRow): void | Promise<void>
  remove(row: ScheduleRow): void | Promise<void>
  openSession(row: ScheduleRow): void | Promise<void>
  close(): void | Promise<void>
  /** Rows the window may take; it fills its parent when omitted. */
  height?: Accessor<number | undefined>
  /** The window's own box, for the host to focus and measure. */
  onRoot?(box: BoxRenderable): void
  scopeChanged?(scope: "current" | "all"): void
  bindKeys?(target: () => BoxRenderable | undefined, actions: { key: string; run: () => void }[]): () => void
}

type Scope = "current" | "all"
type KeyHint = { key: string; label: string }

const FILTERS: ScheduleFilter[] = ["all", "active", "paused", "done"]
const SCOPES: Scope[] = ["current", "all"]
/** Status list on the left: indent, label, count and its right border. */
const RAIL_WIDTH = 16
/** Wide enough for the status list beside the task list and the details. */
const WIDE = 110
const NEXT_WIDTH = 10
const WHEN_WIDTH = 20
const LABEL_WIDTH = 8
const HINT_GAP = "  "
/** Marks a schedule the service gates with a check before it wakes its session. */
const GATE_GLYPH = "◆"

/** Keep the same schedule through refresh/reordering; otherwise choose its nearest neighbour. */
export function reconcileWindowSelection(rows: ScheduleRow[], id: string | undefined, previousIndex = 0) {
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
export function ScheduleWindow(props: ScheduleWindowProps) {
  const language = () => props.language ?? detectLanguage()
  const text = () => words(language())
  const describeWhen = (when: ScheduleWhen) => {
    switch (when.type) {
      case "in": return text().whenIn(when.in)
      case "at": return text().whenAt(when.at)
      case "every": return text().whenEvery(when.every)
      case "cron": return `Cron ${when.cron}`
    }
  }
  const terminal = useTerminalDimensions()
  const [width, setWidth] = createSignal(Math.max(20, terminal().width - 4))
  const [filter, setFilter] = createSignal<ScheduleFilter>("all")
  const [scope, setScope] = createSignal<Scope>(props.currentSessionID() ? "current" : "all")
  createEffect(() => props.scopeChanged?.(scope()))
  const [query, setQuery] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [selectedID, setSelectedID] = createSignal<string>()
  const [pending, setPending] = createSignal(false)
  const [actionError, setActionError] = createSignal<string>()
  const [showWarnings, setShowWarnings] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const [hasKeyboard, setHasKeyboard] = createSignal(false)
  let root: BoxRenderable | undefined
  let list: ScrollBoxRenderable | undefined
  let detail: ScrollBoxRenderable | undefined
  let previousIndex = 0
  let alive = true
  const theme = props.theme
  const faint = () => theme().faint ?? theme().muted
  const warnings = () => props.warnings?.() ?? []

  const wide = () => width() >= WIDE
  const detailWidth = () => wide() ? Math.min(60, Math.max(40, Math.floor(width() * 0.4))) : width()
  const listWidth = () => wide() ? width() - RAIL_WIDTH - 1 - detailWidth() : width()
  /** Inside the list: its scrollbar column stays free. */
  const rowWidth = () => listWidth() - 2
  const whenWidth = () => rowWidth() >= 56 ? WHEN_WIDTH : 0
  const nameWidth = () => Math.max(6, rowWidth() - 2 - NEXT_WIDTH - 2 - (whenWidth() ? whenWidth() + 2 : 0))

  const scoped = createMemo(() => scope() === "all" ? props.rows()
    : props.rows().filter((row) => !!props.currentSessionID() && row.sessionID === props.currentSessionID()))
  const counts = createMemo(() => countSchedules(scoped()))
  const visible = createMemo(() => selectSchedules(scoped(), { status: filter(), query: query() }))
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
    if (id) queueMicrotask(() => { if (alive) list?.scrollChildIntoView(`schedule-row-${id}`) })
  })
  createEffect(() => { if (!warnings().length) setShowWarnings(false) })
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
    if (showWarnings()) setShowWarnings(false)
    else if (query()) setQuery("")
    else close()
  }
  const switchFilter = (delta: number) => setFilter(FILTERS[(FILTERS.indexOf(filter()) + delta + FILTERS.length) % FILTERS.length]!)
  function move(delta: number) {
    const rows = visible()
    const index = rows.findIndex((row) => row.id === selectedID())
    setSelectedID(rows[Math.max(0, Math.min(rows.length - 1, index + delta))]?.id)
    setShowWarnings(false)
  }
  function toggle() {
    const row = selected()
    if (row?.status === "active") void invoke(() => props.pause(row))
    if (row?.status === "paused") void invoke(() => props.resume(row))
  }
  const remove = () => { const row = selected(); if (row) void invoke(() => props.remove(row)) }
  const open = () => { const row = selected(); if (row?.sessionID) void invoke(() => props.openSession(row)) }
  const actions = [
    { key: "up", run: () => move(-1) }, { key: "k", run: () => move(-1) },
    { key: "down", run: () => move(1) }, { key: "j", run: () => move(1) },
    { key: "left", run: () => switchFilter(-1) }, { key: "right", run: () => switchFilter(1) },
    { key: "tab", run: () => switchFilter(1) }, { key: "shift+tab", run: () => switchFilter(-1) },
    { key: "/", run: () => setSearching(true) },
    { key: "s", run: () => setScope(scope() === "all" ? "current" : "all") },
    { key: "w", run: () => { if (warnings().length) setShowWarnings(!showWarnings()) } },
    { key: "escape", run: escape },
    { key: "r", run: () => { void invoke(props.refresh) } }, { key: "p", run: toggle },
    { key: "d", run: remove }, { key: "o", run: open },
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
  const statusColor = (status: ScheduleRow["status"]) =>
    status === "active" ? theme().success : status === "paused" ? theme().warning : theme().muted
  const pickFilter = (value: ScheduleFilter) => { setFilter(value); root?.focus() }
  const title = (row: ScheduleRow) => row.name || row.prompt.replace(/\s+/g, " ").trim() || row.id

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
    if (!hasKeyboard()) return [{ key: text().clickWindow, label: text().keyboardElsewhere }, { key: "/schedule_status", label: text().close }]
    const row = selected()
    return [
      { key: "↑↓", label: text().select },
      { key: wide() ? "tab" : "←→", label: text().status },
      { key: "s", label: scope() === "all" ? text().onlyCurrent : text().allSessions },
      { key: "/", label: text().search },
      { key: "r", label: text().refresh },
      ...(row?.status === "active" ? [{ key: "p", label: text().pause }] : row?.status === "paused" ? [{ key: "p", label: text().resume }] : []),
      ...(row ? [{ key: "d", label: text().remove }] : []),
      ...(row?.sessionID ? [{ key: "o", label: text().openSession }] : []),
      ...(warnings().length ? [{ key: "w", label: text().readIssues }] : []),
      { key: "esc", label: showWarnings() ? text().back : query() ? text().clearSearch : text().close },
    ]
  }

  const notice = (): { text: string; color: string | RGBA } | undefined => {
    const failure = actionError() || props.error()
    if (failure) return { text: `✕ ${failure}`, color: theme().error }
    const count = warnings().length
    if (count) return { text: text().warningSummary(count), color: theme().warning }
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
        {`  ${fit(text().task, nameWidth())}  ${whenWidth() ? `${fit(text().plan, whenWidth())}  ` : ""}${fit(text().next, NEXT_WIDTH, "right")}`}
      </text>
      <scrollbox id="schedule-list" ref={list} flexGrow={1} flexBasis={0} minHeight={0} scrollX={false}>
        <Show when={visible().length} fallback={<text fg={theme().muted} wrapMode="word" marginTop={1}>{`  ${emptyText()}`}</text>}>
          <For each={visible()}>{(row) => {
            const chosen = () => selectedID() === row.id
            /** Keeps the row's total width stable, so the gate marker never shifts the columns beside it. */
            const gate = () => scheduleCheck(row) ? `${GATE_GLYPH} ` : ""
            const name = () => fit(title(row), nameWidth() - columns(gate()))
            return <box id={`schedule-row-${row.id}`} height={1} flexShrink={0}
              backgroundColor={chosen() ? theme().raised : undefined}
              onMouseUp={() => { setSelectedID(row.id); setShowWarnings(false); root?.focus() }}>
              <text wrapMode="none" selectable={false}>
                <span style={{ fg: statusColor(row.status) }}>{`${STATUS_GLYPHS[row.status]} `}</span>
                <span style={{ fg: theme().warning }}>{gate()}</span>
                {chosen()
                  ? <b style={{ fg: theme().accent }}>{name()}</b>
                  : <span style={{ fg: row.status === "done" ? theme().muted : theme().text }}>{name()}</span>}
                <span style={{ fg: theme().muted }}>{whenWidth() ? `  ${fit(describeWhen(row.when), whenWidth())}` : ""}</span>
                <span style={{ fg: row.status === "active" ? theme().text : faint() }}>{`  ${fit(nextLabel(row, now(), language()), NEXT_WIDTH, "right")}`}</span>
              </text>
            </box>
          }}</For>
        </Show>
      </scrollbox>
    </box>

  /** The check itself: the command for a shell gate, the script for a code gate. */
  const conditionTarget = (condition: ScheduleCondition) =>
    condition.type === "shell" ? condition.run : condition.code.trim()

  /** How a shell check decides to pass; the service allows at most one predicate. */
  const conditionRule = (condition: ScheduleCondition) => {
    if (condition.type === "code") return undefined
    if (condition.is !== undefined) return text().conditionRuleIs(condition.is)
    if (condition.matches !== undefined) return text().conditionRuleMatches(condition.matches)
    if (condition.changes) return text().conditionRuleChanges
    return text().conditionRuleExit
  }

  const Condition = (conditionProps: { row: ScheduleRow }) => {
    const check = () => scheduleCheck(conditionProps.row)
    return <Show when={check()}>{(gate) =>
      <>
        <text fg={theme().muted} flexShrink={0}>{text().condition}</text>
        <text wrapMode="word" flexShrink={0}>
          <span style={{ fg: theme().warning }}>{`${GATE_GLYPH} `}</span>
          <span style={{ fg: theme().text }}>
            {gate().mode === "if" ? text().conditionIf : text().conditionUntil}
          </span>
        </text>
        <box flexShrink={0} border={["left"]} borderColor={theme().warning} paddingLeft={1}>
          <box flexDirection="column" flexShrink={0}>
            <Field label={gate().condition.type === "shell" ? text().conditionShell : text().conditionCode}>
              {conditionTarget(gate().condition)}
            </Field>
            <Show when={conditionRule(gate().condition)}>{(rule) =>
              <Field label={text().conditionRule}>{rule()}</Field>}</Show>
          </box>
        </box>
        <text fg={faint()} wrapMode="word" flexShrink={0}>
          {gate().mode === "if" ? text().conditionIfNote : text().conditionUntilNote}
        </text>
        <Show when={gate().condition.type === "code"}>
          <text fg={faint()} wrapMode="word" flexShrink={0}>{text().conditionCodeNote}</text>
        </Show>
        <text fg={faint()} wrapMode="word" flexShrink={0}>{text().conditionFailureNote}</text>
        <box height={1} flexShrink={0} />
      </>
    }</Show>
  }

  const Detail = (detailProps: { row: ScheduleRow }) => {
    const row = () => detailProps.row
    return <box flexDirection="column" flexShrink={0}>
      <text fg={theme().text} wrapMode="word" flexShrink={0}><b>{title(row())}</b></text>
      <text wrapMode="none" flexShrink={0}>
        <span style={{ fg: statusColor(row().status) }}>{`${STATUS_GLYPHS[row().status]} ${text().statuses[row().status]}`}</span>
        <span style={{ fg: faint() }}>{`  ·  ${describeWhen(row().when)}`}</span>
      </text>
      <box height={1} flexShrink={0} />
      <Field label={text().next}>{row().status === "active" && row().nextDueAt !== undefined
        ? text().nextTime(clockTime(row().nextDueAt, now(), language()), relativeTime(row().nextDueAt, now(), language()))
        : row().status === "paused" ? text().pausedNext : row().status === "done" ? text().noMoreRuns : "—"}</Field>
      <Field label={text().timeZone}>{row().tz}</Field>
      <Field label={text().ends}>{row().endsAt !== undefined ? clockTime(row().endsAt, now(), language()) : text().unlimited}</Field>
      <Field label={text().runs}>{text().runCount(row().runCount, row().remainingRuns)}</Field>
      <Field label={text().last} color={row().lastOutcome === "failed" ? theme().error : undefined}>
        {row().lastFiredAt !== undefined
          ? `${clockTime(row().lastFiredAt, now(), language())}${row().lastOutcome ? ` · ${text().outcomes[row().lastOutcome!]}` : ""}`
          : text().neverFired}
      </Field>
      <box height={1} flexShrink={0} />
      <Condition row={row()} />
      <text fg={theme().muted} flexShrink={0}>{text().prompt}</text>
      <box flexShrink={0} border={["left"]} borderColor={theme().accent} paddingLeft={1} marginTop={0}>
        <text fg={theme().text} wrapMode="word">{row().prompt || "—"}</text>
      </box>
      <box height={1} flexShrink={0} />
      <text fg={theme().muted} flexShrink={0}>{text().session}</text>
      <text fg={theme().text} wrapMode="word" flexShrink={0}>{row().session?.title || row().sessionID || text().unknownSession}</text>
      <Show when={row().session?.directory}><text fg={faint()} wrapMode="word" flexShrink={0}>{row().session?.directory}</text></Show>
      <box height={1} flexShrink={0} />
      <text fg={theme().muted} flexShrink={0}>{text().execution}</text>
      <text fg={theme().text} wrapMode="word" flexShrink={0}>{text().executionNote}</text>
      <box height={1} flexShrink={0} />
      <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
        <Show when={row().status !== "done"}>
          <Button hotkey="p" label={row().status === "active" ? text().pause : text().resume} color={theme().warning} run={toggle} />
        </Show>
        <Button hotkey="d" label={text().remove} color={theme().error} run={remove} />
        <Show when={row().sessionID}><Button hotkey="o" label={text().openSession} color={theme().accent} run={open} /></Show>
      </box>
      <box height={1} flexShrink={0} />
      <text fg={faint()} wrapMode="word" flexShrink={0}>{`${text().scheduleID}: ${row().id}`}</text>
      <text fg={faint()} wrapMode="word" flexShrink={0}>{`${text().sessionID}: ${row().sessionID || "—"}`}</text>
    </box>
  }

  const Warnings = () =>
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme().warning} flexShrink={0}><b>{text().warningTitle(warnings().length)}</b></text>
      <text fg={theme().muted} wrapMode="word" flexShrink={0}>{text().warningHelp}</text>
      <box height={1} flexShrink={0} />
      <For each={warnings()}>{(warning) => <text fg={theme().text} wrapMode="word" flexShrink={0}>{`• ${warning}`}</text>}</For>
    </box>

  return <box
    id="native-schedule-window" focusable flexDirection="column" flexShrink={0}
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
      <box id="schedule-search-box" flexDirection="row" height={1} flexShrink={0} marginTop={1} onMouseUp={() => setSearching(true)}>
        <text fg={theme().accent} flexShrink={0}>{"/ "}</text>
        <Show when={searching()} fallback={<text fg={theme().text} wrapMode="none">{query()}</text>}>
          <input id="schedule-search" flexGrow={1} value={query()} onInput={setQuery} focused={searching()}
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
      <text flexShrink={0} height={1} marginTop={1} fg={item().color} wrapMode="none" selectable={false}
        onMouseUp={() => { if (warnings().length) setShowWarnings(!showWarnings()) }}>
        {fit(item().text, width())}
      </text>}
    </Show>
    <box flexDirection={wide() ? "row" : "column"} flexGrow={1} flexBasis={0} minHeight={0} marginTop={1} overflow="hidden">
      <Show when={wide()}><Rail /></Show>
      <List />
      <scrollbox id="schedule-detail" ref={detail} flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} scrollX={false}
        border={wide() ? ["left"] : ["top"]} borderColor={theme().border} paddingLeft={wide() ? 2 : 0} paddingRight={1}>
        <Show when={!showWarnings()} fallback={<Warnings />}>
          <Show when={selected()} fallback={<text fg={faint()} wrapMode="word">{visible().length ? text().selectTask : ""}</text>}>
            {(row) => <Detail row={row()} />}
          </Show>
        </Show>
      </scrollbox>
    </box>
    <box id="schedule-footer" flexDirection="column" flexShrink={0} marginTop={1}>
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
