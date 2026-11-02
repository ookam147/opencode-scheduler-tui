# OpenCode Native Scheduler

[简体中文](./README.zh-CN.md)

A session-aware TUI for **OpenCode's native schedule service**. Requires OpenCode **2.2.3** or later (verified on 2.2.5).

The host owns timing, persistence and prompt delivery. The plugin does not install launchd/systemd/cron jobs, spawn `opencode run`, read a local SQLite database, or register competing scheduler tools.

## Task center

Inside a conversation, run `/schedule_status` or **Show or hide scheduled tasks** in the command palette. Like the Quota window, it opens above the message box, covers only the conversation area and gives way to the sidebar. Run the command again or press `Esc` to close; the keyboard returns to the message box.

- Fixed header, status tabs, category rail, independent list/detail scrolling and keyboard footer; responsive layout inspired by the Quota TUI, independently implemented.
- Native `active`, `paused`, `done` states, current/all-session scope and text search.
- Trigger, timezone, next due time, run count, last outcome, owning session title/ID and directory.
- No manual creation: ask the agent, which uses OpenCode's native `schedule` tool (or the built-in `/schedule` command). The window is for reviewing and managing.
- Pause, resume, confirmed deletion and navigation to the owning conversation.
- No invented “run now”, edit, OS health checks or full run history: native APIs do not provide these operations.

## Local loading

```sh
npm install
npm run build
```

Use Bun 1.3.14+ for build/test. OpenTUI 0.8.0's Node engine requires Node 26.4.0+; the plugin itself runs in OpenCode's Bun host. `@opencode/plugin` is an optional peer provided by the host, so it is not installed with the plugin.

For this checkout, add its **directory** to `plugins` in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["/absolute/path/to/opencode-scheduler"]
}
```

Alternatively load the directory in `opencode.json`'s `plugins`; its V2 server part is a no-op and exists only to allow TUI-part discovery. Preserve existing entries. **This migration does not edit your configuration automatically.** Configuration changes apply via hot reload or `/reload`.

Native schedules must be enabled in the relevant OpenCode configuration:

```json
{
  "experimental": { "schedules": true }
}
```

Schedules belong to sessions; ask the agent in the conversation that should receive the prompt.

## Language and session configuration

The window automatically selects Chinese for mainland China, Hong Kong, Macau and Taiwan IANA time zones; other time zones use English. This uses the user's local time zone, not the schedule's time zone. Time zone is only a language heuristic, not a reliable indication of a person's language preference. User-authored names and prompts are never translated.

Details show the owning session's name, directory and navigation action. Agent/model/provider/reasoning settings are intentionally not displayed: a session's current selection must not be mistaken for a schedule's fixed execution configuration.

The `d` action asks for confirmation, then calls the native schedule deletion API. It is another entry point to native deletion, not a separate scheduler; it does not delete the owning session or its messages.

## Gated schedules

OpenCode 2.2.3 can gate a schedule on a condition the service evaluates before waking a session, with no model call. Gated tasks are marked with `◆` in the list (`if` in the theme's warning colour, `until` in its info colour), tagged `waiting` when the last check did not pass, and the details explain the gate:

- `if` is checked before every run to decide whether that run happens.
- `until` waits for the condition to hold, then runs once. If it times out unmet, it still runs once and notes the condition was not met.

A check is either a shell command run in the session's directory (passing on exit code 0, or when its output equals `is`, matches `matches`, or differs from the previous check via `changes`) or a confined Code Mode script with no network access. Three consecutive check errors (timeout, command error, etc.) pause the task; an unmet condition is not an error. Two outcomes report check activity: `checked` (evaluated without waking) and `expired` (an `until` gate that timed out).

Gates are only displayed, never created here; `schedule_create` remains the agent's job. `lastOutput` is not shown because the service returns it only from creation, never from the list and get APIs this window uses.

## Refresh behavior

All requests use the connected host's `context.client`, including remote services. The native list API requires a session ID. “All sessions” walks all session pages and combines schedule lists with a maximum of four concurrent requests. Inaccessible sessions produce visible warnings, not silent claims of completeness; sessions whose directory was deleted are skipped (judged by the local file system).

Current-session data refreshes every five seconds while the page is open. All-session fan-out runs at most once per minute automatically. Mutations and `r` refresh immediately. Requests/timers are cancelled when the window closes; stale responses cannot replace a newer scope.

## Keys

`↑↓` / `j k`: select · `←→` / `Tab`: status · `s`: scope · `/`: search · `r`: refresh · `p`: pause/resume · `d`: delete · `o`: open conversation · `PgUp/PgDn`: detail scroll · `Esc`: close (or leave search first).

## Migration and validation

- [Migration notes](./docs/native-migration.md)
- Old OS scheduler sources/tests have been removed (see Git history for 1.4.1 and earlier); the package exports only `dist/native/server.js` and `dist/native/tui.js`. Existing system timers/files are **not** removed or converted.
- [Legacy documentation](./docs/legacy-readme.md) describes the old implementation, not the current native entrypoint.

```sh
npm run typecheck
npm run build
npm test
npm run check:exports
```

The new entrypoints are `dist/native/server.js` and `dist/native/tui.js`. SDK/OpenTUI/Solid imports stay external so the host owns shared runtimes.
