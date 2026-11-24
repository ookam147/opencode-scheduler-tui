// @bun
// src/native/tui.tsx
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect as createEffect2, createSignal as createSignal2, onCleanup as onCleanup2, onMount as onMount2, Show as Show2 } from "solid-js";

// src/native/model.ts
function targetSessionID(row) {
  return row.action.type === "prompt" && row.action.to.session ? row.action.to.session : row.sessionID;
}
var HANDOFF = /^(Prompted|Started subagent) ses_\S+$/m;
function codeWake(row) {
  if (row.action.type !== "code" || row.lastOutcome !== "fired" && row.lastOutcome !== "late")
    return;
  const first = row.lastOutput?.split(`
`, 1)[0] ?? "";
  return HANDOFF.test(first) ? "woke" : "quiet";
}
function belongsTo(row, sessionID) {
  return !!sessionID && (row.sessionID === sessionID || targetSessionID(row) === sessionID);
}
function actionBody(action) {
  switch (action.type) {
    case "prompt":
      return action.prompt;
    case "code":
      return action.code;
    case "shell":
      return action.command;
  }
}
function describeTrigger(trigger) {
  switch (trigger.type) {
    case "at":
      return `\u5355\u6B21 ${trigger.at}`;
    case "every":
      return `\u6BCF\u9694 ${trigger.every}`;
    case "cron":
      return `Cron ${trigger.cron}`;
    case "event":
      return `MCP ${trigger.server}/${trigger.event}`;
  }
}
function selectAutomations(rows, options = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return rows.filter((row) => {
    if (options.status && options.status !== "all" && row.status !== options.status)
      return false;
    if (options.sessionID && !belongsTo(row, options.sessionID))
      return false;
    const action = row.action;
    return !query || [
      row.id,
      row.name,
      actionBody(action),
      action.type,
      action.type === "prompt" ? action.to.subagent ?? action.to.session : undefined,
      row.sessionID,
      row.session?.title,
      row.target?.title,
      row.directory,
      describeTrigger(row.trigger),
      row.tz,
      row.lastOutput
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}
function nextRank(row) {
  if (row.status === "active")
    return row.nextDueAt !== undefined ? 0 : 1;
  return row.status === "paused" ? 2 : 3;
}
function sortAutomations(rows, sort, locale) {
  if (sort === "created")
    return rows;
  const name = (row) => row.name || actionBody(row.action);
  return [...rows].sort((a, b) => sort === "name" ? name(a).localeCompare(name(b), locale, { numeric: true, sensitivity: "base" }) : nextRank(a) - nextRank(b) || (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0));
}
function countAutomations(rows) {
  return rows.reduce((counts, row) => {
    counts.all++;
    counts[row.status]++;
    return counts;
  }, { all: 0, active: 0, paused: 0, done: 0 });
}

// src/native/client.ts
function toAutomation(info) {
  return info;
}
function request(signal, run) {
  signal?.throwIfAborted();
  if (!signal)
    return run();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return run();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function createAutomationClient(client, lookup = () => {
  return;
}) {
  const api = client.experimental.automation;
  const session = (id) => {
    if (!id)
      return;
    const info = lookup(id);
    return { id, ...info?.title ? { title: info.title } : {} };
  };
  return {
    async list(options = {}) {
      const { signal } = options;
      const rows = await request(signal, () => api.list(undefined, { signal }));
      signal?.throwIfAborted();
      return rows.map((info) => {
        const row = toAutomation(info);
        const target = targetSessionID(row);
        return { ...row, session: session(row.sessionID), ...target !== row.sessionID ? { target: session(target) } : {} };
      });
    },
    async pause(id) {
      return toAutomation(await api.pause({ automationID: id }));
    },
    async resume(id) {
      return toAutomation(await api.resume({ automationID: id }));
    },
    async remove(id) {
      await api.delete({ automationID: id });
    }
  };
}

// src/native/room.ts
var MIN_ROOM = 12;
function composerRoom(box) {
  let branch = box;
  for (let column = box.parent;column; branch = column, column = column.parent) {
    const rows = column.getChildren();
    const messages = rows[0];
    if (!messages || messages === branch)
      continue;
    if (!messages.getChildren().some((item) => ("scrollChildIntoView" in item)))
      continue;
    const otherRows = rows.reduce((total, row) => row === branch || row === messages ? total : total + row.height, 0);
    const besideBox = branch.height - box.height;
    return Math.max(MIN_ROOM, column.height - 1 - otherRows - besideBox);
  }
  return;
}

// src/native/snapshot.ts
function retainUnchangedRows(previous, next) {
  const byID = new Map(previous.map((row) => [row.id, row]));
  const result = next.map((row) => {
    const old = byID.get(row.id);
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row;
  });
  return result.length === previous.length && result.every((row, index) => row === previous[index]) ? previous : result;
}

// src/native/i18n.ts
var zh = {
  title: "Automations",
  current: "\u5F53\u524D\u4F1A\u8BDD",
  allSessions: "\u6240\u6709\u4F1A\u8BDD",
  status: "\u72B6\u6001",
  task: "\u4EFB\u52A1",
  plan: "\u89E6\u53D1",
  next: "\u4E0B\u6B21",
  timeZone: "\u65F6\u533A",
  ends: "\u622A\u6B62",
  runs: "\u5DF2\u8FD0\u884C",
  last: "\u4E0A\u6B21",
  lastOutput: "\u4E0A\u6B21\u8F93\u51FA",
  session: "\u521B\u5EFA\u4F1A\u8BDD",
  unknownSession: "\u672A\u77E5\u4F1A\u8BDD",
  eventArgs: "\u4E8B\u4EF6\u53C2\u6570",
  action: "\u52A8\u4F5C",
  actions: { prompt: "\u63D0\u793A\u8BCD", subagent: "\u5B50\u4EE3\u7406", code: "Code Mode \u811A\u672C", shell: "Shell \u547D\u4EE4" },
  sendTo: "\u53D1\u9001\u5230",
  help: "\u5E2E\u52A9",
  helpTitle: "\u5E2E\u52A9",
  helpClose: "\u8FD4\u56DE",
  helpSections: [
    { title: "\u5217\u8868\u6807\u8BB0", items: [
      ["\u25CF", "\u8FD0\u884C\u4E2D\uFF1A\u4F1A\u6309\u8BA1\u5212\u89E6\u53D1"],
      ["\u2016", "\u5DF2\u6682\u505C\uFF1A\u4E0D\u4F1A\u89E6\u53D1\uFF0C\u6062\u590D\u540E\u7EE7\u7EED"],
      ["\u2713", "\u5DF2\u7ED3\u675F\uFF1A\u4E0D\u4F1A\u518D\u89E6\u53D1"],
      ["\u65E0\u6807\u8BB0", "\u63D0\u793A\u8BCD\uFF1A\u53D1\u5230\u4F1A\u8BDD\uFF0C\u5524\u9192 AI"],
      ["\u21B3", "\u5B50\u4EE3\u7406\uFF1A\u53D1\u7ED9\u5B50\u4EE3\u7406\uFF0C\u5524\u9192 AI"],
      ["\u03BB", "Code Mode \u811A\u672C\uFF1A\u8FD0\u884C\u811A\u672C\uFF0C\u6309\u9700\u5524\u9192 AI"],
      ["$", "Shell \u547D\u4EE4\uFF1A\u8FD0\u884C\u547D\u4EE4\uFF0C\u4E0D\u8C03\u7528 AI"],
      ["\u5931\u8D25", "\u4E0A\u6B21\u8FD0\u884C\u5931\u8D25"]
    ] },
    { title: "\u56DB\u79CD\u52A8\u4F5C", items: [
      ["\u63D0\u793A\u8BCD", "\u89E6\u53D1\u65F6\u628A\u63D0\u793A\u8BCD\u53D1\u8FDB\u76EE\u6807\u4F1A\u8BDD\uFF0C\u4F1A\u8BDD\u91CC\u7684 AI \u63A5\u7740\u5904\u7406\uFF0C\u56DE\u590D\u51FA\u73B0\u5728\u90A3\u4E2A\u4F1A\u8BDD\u91CC\u3002"],
      ["\u5B50\u4EE3\u7406", "\u6BCF\u6B21\u89E6\u53D1\u65B0\u5F00\u4E00\u4E2A\u5B50\u4F1A\u8BDD\uFF0C\u4EA4\u7ED9\u6307\u5B9A\u7684\u5B50\u4EE3\u7406\u5904\u7406\u3002\u7ED3\u679C\u53EA\u7559\u5728\u5B50\u4F1A\u8BDD\u91CC\uFF0C\u539F\u4F1A\u8BDD\u6536\u4E0D\u5230\u6D88\u606F\uFF0C\u539F\u6765\u7684 AI \u4E5F\u4E0D\u4F1A\u88AB\u53EB\u9192\uFF1B\u8981\u770B\u7ED3\u679C\uFF0C\u9700\u4ECE\u4F1A\u8BDD\u5217\u8868\u6253\u5F00\u90A3\u4E2A\u5B50\u4F1A\u8BDD\u3002"],
      ["Code Mode", "\u8FD0\u884C\u4E00\u6BB5\u811A\u672C\uFF0C\u4E0D\u8C03\u7528 AI\u3002\u811A\u672C\u53EF\u4EE5\u67E5\u6570\u636E\uFF08\u4F8B\u5982\u7528 fetch \u8BF7\u6C42\u63A5\u53E3\uFF09\uFF0C\u8FD4\u56DE send \u65F6\u624D\u5524\u9192 AI\uFF0C\u8FD4\u56DE done \u65F6\u7ED3\u675F\u4EFB\u52A1\uFF0C\u8FD4\u56DE state \u7559\u7ED9\u4E0B\u6B21\u8FD0\u884C\u3002\u5355\u6B21\u9650\u65F6 30 \u79D2\uFF0C\u8FDE\u7EED\u5931\u8D25 3 \u6B21\u81EA\u52A8\u6682\u505C\u3002"],
      ["Shell", "\u5728\u4EFB\u52A1\u76EE\u5F55\u91CC\u8FD0\u884C\u4E00\u6761\u56FA\u5B9A\u547D\u4EE4\uFF0C\u4E0D\u8C03\u7528 AI\uFF0C\u8BB0\u5F55\u9000\u51FA\u7801\u548C\u8F93\u51FA\u3002"]
    ] },
    { title: "\u8BE6\u60C5\u91CC\u7684\u5B57\u6BB5", items: [
      ["\u4E0A\u6B21", "\u4E0A\u6B21\u8FD0\u884C\u7684\u65F6\u95F4\u548C\u7ED3\u679C\u3002Code Mode \u4F1A\u6CE8\u660E\u8FD9\u6B21\u662F\u5426\u5524\u9192\u4E86 AI\u3002"],
      ["\u4E0A\u6B21\u8F93\u51FA", "\u4E0A\u6B21\u8FD0\u884C\u7559\u4E0B\u7684\u8BB0\u5F55\uFF1AShell \u7684\u9000\u51FA\u7801\u548C\u8F93\u51FA\u3001\u811A\u672C\u7684\u65E5\u5FD7\u3001\u6682\u505C\u539F\u56E0\u7B49\u3002"],
      ["\u4FDD\u5B58\u7684\u72B6\u6001", "Code Mode \u811A\u672C\u7559\u7ED9\u4E0B\u6B21\u8FD0\u884C\u7684\u6570\u636E\u3002"],
      ["\u53D1\u9001\u5230", "\u63D0\u793A\u8BCD\u53D1\u5F80\u7684\u4F1A\u8BDD\uFF1B\u53EA\u6709\u53D1\u5230\u521B\u5EFA\u4F1A\u8BDD\u4EE5\u5916\u7684\u4F1A\u8BDD\u65F6\u624D\u663E\u793A\u3002"]
    ] }
  ],
  automationID: "\u4EFB\u52A1 ID",
  sessionID: "\u4F1A\u8BDD ID",
  statuses: { all: "\u5168\u90E8", active: "\u8FD0\u884C\u4E2D", paused: "\u5DF2\u6682\u505C", done: "\u5DF2\u7ED3\u675F" },
  outcomes: {
    fired: "\u5DF2\u89E6\u53D1",
    late: "\u5EF6\u8FDF\u89E6\u53D1",
    skipped: "\u5DF2\u8DF3\u8FC7",
    disabled: "\u914D\u7F6E\u5DF2\u5173\u95ED",
    failed: "\u5931\u8D25",
    expired: "\u5DF2\u8FC7\u671F"
  },
  failedTag: "\u5931\u8D25",
  wakes: { woke: "\u5DF2\u5524\u9192 AI", quiet: "\u672A\u5524\u9192 AI" },
  savedState: "\u4FDD\u5B58\u7684\u72B6\u6001",
  done: "\u5B8C\u6210",
  backToList: "\u8FD4\u56DE\u5217\u8868",
  clickWindow: "\u70B9\u51FB\u6B64\u7A97\u53E3",
  keyboardElsewhere: "\u4F7F\u7528\u5FEB\u6377\u952E\uFF08\u952E\u76D8\u5F53\u524D\u5728\u8F93\u5165\u6846\uFF09",
  close: "\u5173\u95ED",
  select: "\u9009\u62E9",
  onlyCurrent: "\u4EC5\u5F53\u524D\u4F1A\u8BDD",
  search: "\u641C\u7D22",
  refresh: "\u5237\u65B0",
  pause: "\u6682\u505C",
  resume: "\u6062\u590D",
  remove: "\u5220\u9664",
  openSession: "\u6253\u5F00\u4F1A\u8BDD",
  clearSearch: "\u6E05\u9664\u641C\u7D22",
  refreshing: "\u5237\u65B0\u4E2D\u2026",
  processing: "\u5904\u7406\u4E2D\u2026",
  searchPlaceholder: "\u641C\u7D22\u540D\u79F0\u3001\u63D0\u793A\u8BCD\u3001\u547D\u4EE4\u6216\u4F1A\u8BDD",
  selectTask: "\u9009\u62E9\u4E00\u4E2A\u4EFB\u52A1\u67E5\u770B\u8BE6\u60C5",
  reading: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u2026",
  readFailed: "\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25\uFF0C\u6309 r \u91CD\u8BD5",
  noCurrent: "\u5F53\u524D\u4E0D\u5728\u4F1A\u8BDD\u4E2D\uFF0C\u6309 s \u67E5\u770B\u6240\u6709\u4F1A\u8BDD",
  noMatches: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4EFB\u52A1",
  noSessionTasks: "\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u81EA\u52A8\u5316\u4EFB\u52A1\u3002\u76F4\u63A5\u8BA9 agent \u5B89\u6392\uFF0C\u6216\u4F7F\u7528 /automation\uFF0C\u4F8B\u5982\u300C\u6BCF\u4E2A\u5DE5\u4F5C\u65E5 9 \u70B9\u603B\u7ED3\u6628\u5929\u7684\u63D0\u4EA4\u300D",
  noTasks: "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u81EA\u52A8\u5316\u4EFB\u52A1",
  pausedNext: "\u6682\u505C\u4E2D\uFF0C\u6062\u590D\u540E\u8BA1\u7B97",
  noMoreRuns: "\u4E0D\u518D\u89E6\u53D1",
  onEvent: "\u6536\u5230\u4E8B\u4EF6\u65F6",
  unlimited: "\u4E0D\u9650",
  neverFired: "\u5C1A\u672A\u89E6\u53D1",
  runCount: (count) => `${count} \u6B21`,
  nextTime: (clock, relative) => `${clock}\uFF08${relative}\uFF09`,
  whenAt: (value) => `\u5355\u6B21 ${value}`,
  whenEvery: (value) => `\u6BCF\u9694 ${value}`,
  whenEvent: (server, event) => `\u4E8B\u4EF6 ${server}/${event}`,
  today: "\u4ECA\u5929",
  tomorrow: "\u660E\u5929",
  yesterday: "\u6628\u5929",
  soon: "\u5373\u5C06",
  justNow: "\u521A\u521A",
  relative: (value, unit, future) => `${value} ${{ minute: "\u5206\u949F", hour: "\u5C0F\u65F6", day: "\u5929" }[unit]}${future ? "\u540E" : "\u524D"}`,
  sessionRequired: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u67E5\u770B\u81EA\u52A8\u5316\u4EFB\u52A1\u3002",
  resumeTitle: "\u6062\u590D\u81EA\u52A8\u5316\u4EFB\u52A1",
  resumeMessage: "\u9519\u8FC7\u7684\u4E00\u6B21\u6027\u4EFB\u52A1\u4F1A\u7ACB\u5373\u8865\u8DD1\u4E00\u6B21\uFF1B\u91CD\u590D\u4EFB\u52A1\u4ECE\u4E0B\u4E00\u4E2A\u65F6\u95F4\u69FD\u6062\u590D\uFF1B\u4E8B\u4EF6\u76D1\u542C\u4ECE\u4FDD\u5B58\u7684\u4F4D\u7F6E\u7EE7\u7EED\u3002\u662F\u5426\u7EE7\u7EED\uFF1F",
  deleteTitle: "\u5220\u9664\u81EA\u52A8\u5316\u4EFB\u52A1",
  deleteMessage: (name, session) => `\u786E\u5B9A\u5220\u9664\u300C${name}\u300D\u5417\uFF1F
\u521B\u5EFA\u4F1A\u8BDD\uFF1A${session}
\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002`,
  confirmDelete: "\u786E\u8BA4\u5220\u9664",
  cancel: "\u53D6\u6D88",
  commandTitle: "\u81EA\u52A8\u5316\u4EFB\u52A1",
  settings: "\u8BBE\u7F6E",
  settingsTitle: "Automations \u8BBE\u7F6E",
  settingsCommand: "\u81EA\u52A8\u5316\u4EFB\u52A1\u8BBE\u7F6E",
  languageSetting: "\u754C\u9762\u8BED\u8A00",
  refreshSetting: "\u81EA\u52A8\u5237\u65B0",
  scopeSetting: "\u9ED8\u8BA4\u8303\u56F4",
  filterSetting: "\u9ED8\u8BA4\u72B6\u6001",
  sortSetting: "\u6392\u5E8F\u65B9\u5F0F",
  timeSetting: "\u65F6\u95F4\u663E\u793A",
  sorts: { created: "\u521B\u5EFA\u65F6\u95F4\uFF08\u6700\u65E9\u5728\u524D\uFF09", next: "\u4E0B\u6B21\u8FD0\u884C\uFF08\u6700\u8FD1\u5728\u524D\uFF09", name: "\u540D\u79F0" },
  timeFormats: { relative: "\u76F8\u5BF9\u65F6\u95F4\uFF08\u5982 3 \u5206\u949F\u540E\uFF09", absolute: "\u5177\u4F53\u65F6\u95F4\uFF08\u5982 \u4ECA\u5929 09:05\uFF09" },
  refreshChoice: (seconds) => seconds ? `\u6BCF ${seconds} \u79D2` : "\u5173\u95ED\uFF08\u6309 r \u624B\u52A8\u5237\u65B0\uFF09"
};
var en = {
  title: "Automations",
  current: "Current session",
  allSessions: "All sessions",
  status: "Status",
  task: "Task",
  plan: "Trigger",
  next: "Next",
  timeZone: "Time zone",
  ends: "Expires",
  runs: "Runs",
  last: "Last",
  lastOutput: "Last output",
  session: "Created in",
  unknownSession: "Unknown session",
  eventArgs: "Event args",
  action: "Action",
  actions: { prompt: "Prompt", subagent: "Subagent", code: "Code Mode script", shell: "Shell command" },
  sendTo: "Sends to",
  help: "Help",
  helpTitle: "Help",
  helpClose: "Back",
  helpSections: [
    { title: "List markers", items: [
      ["\u25CF", "Active: runs on schedule"],
      ["\u2016", "Paused: will not run until resumed"],
      ["\u2713", "Done: will not run again"],
      ["(none)", "Prompt: sent to a session, wakes an agent"],
      ["\u21B3", "Subagent: sent to a subagent, wakes an agent"],
      ["\u03BB", "Code Mode script: wakes an agent only when needed"],
      ["$", "Shell command: no AI call"],
      ["failed", "The last run failed"]
    ] },
    { title: "Actions", items: [
      ["Prompt", "Sends the prompt into the target session; the agent there handles it and replies in that session."],
      ["Subagent", "Each run opens a new child session and hands the prompt to the named subagent. The result stays in that child session: the original session gets no message and its agent is not woken. Open the child session from the session list to see it."],
      ["Code Mode", "Runs a script without calling AI. The script can read data (for example with fetch); returning send wakes an agent, done ends the automation, and state is kept for the next run. Each run is capped at 30 seconds; 3 failures in a row pause it."],
      ["Shell", "Runs one fixed command in the automation's directory without calling AI, and records its exit code and output."]
    ] },
    { title: "Detail fields", items: [
      ["Last", "When it last ran and how that went. For Code Mode, whether that run woke an agent."],
      ["Last output", "What the last run left behind: a shell's exit code and output, a script's logs, or why it paused."],
      ["Saved state", "Data a Code Mode script keeps for its next run."],
      ["Sends to", "The session the prompt goes to; shown only when it is not the creating session."]
    ] }
  ],
  automationID: "Automation ID",
  sessionID: "Session ID",
  statuses: { all: "All", active: "Active", paused: "Paused", done: "Done" },
  outcomes: {
    fired: "Fired",
    late: "Fired late",
    skipped: "Skipped",
    disabled: "Disabled by config",
    failed: "Failed",
    expired: "Expired"
  },
  failedTag: "failed",
  wakes: { woke: "woke an agent", quiet: "no agent woken" },
  savedState: "Saved state",
  done: "Done",
  backToList: "Back to list",
  clickWindow: "Click this window",
  keyboardElsewhere: "for shortcuts (keyboard is in the input)",
  close: "Close",
  select: "Select",
  onlyCurrent: "Current session only",
  search: "Search",
  refresh: "Refresh",
  pause: "Pause",
  resume: "Resume",
  remove: "Delete",
  openSession: "Open session",
  clearSearch: "Clear search",
  refreshing: "Refreshing\u2026",
  processing: "Processing\u2026",
  searchPlaceholder: "Search names, prompts, commands or sessions",
  selectTask: "Select a task to view details",
  reading: "Reading tasks\u2026",
  readFailed: "Could not read tasks; press r to retry",
  noCurrent: "No current session; press s to view all sessions",
  noMatches: "No matching tasks",
  noSessionTasks: "This session has no automations. Ask the agent or use /automation, e.g. \u201CSummarize yesterday's commits at 9 on weekdays\u201D.",
  noTasks: "No automations yet",
  pausedNext: "Paused; recalculated on resume",
  noMoreRuns: "Will not run again",
  onEvent: "On each event",
  unlimited: "Unlimited",
  neverFired: "Not yet run",
  runCount: (count) => `${count} run(s)`,
  nextTime: (clock, relative) => `${clock} (${relative})`,
  whenAt: (value) => `Once ${value}`,
  whenEvery: (value) => `Every ${value}`,
  whenEvent: (server, event) => `Event ${server}/${event}`,
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  soon: "Soon",
  justNow: "Just now",
  relative: (value, unit, future) => {
    const text = `${value} ${unit}${value === 1 ? "" : "s"}`;
    return future ? `in ${text}` : `${text} ago`;
  },
  sessionRequired: "Open a session first to view automations.",
  resumeTitle: "Resume automation",
  resumeMessage: "A missed one-time run fires once right away; repeating timers resume at their next slot; event watches continue from their saved position. Continue?",
  deleteTitle: "Delete automation",
  deleteMessage: (name, session) => `Delete \u201C${name}\u201D?
Created in: ${session}
This cannot be undone.`,
  confirmDelete: "Delete",
  cancel: "Cancel",
  commandTitle: "Show or hide automations",
  settings: "Settings",
  settingsTitle: "Automations settings",
  settingsCommand: "Automations settings",
  languageSetting: "Language",
  refreshSetting: "Auto refresh",
  scopeSetting: "Default scope",
  filterSetting: "Default status",
  sortSetting: "Sort by",
  timeSetting: "Time display",
  sorts: { created: "Created (oldest first)", next: "Next run (soonest first)", name: "Name" },
  timeFormats: { relative: "Relative (e.g. in 3 minutes)", absolute: "Clock time (e.g. Today 09:05)" },
  refreshChoice: (seconds) => seconds ? `Every ${seconds} seconds` : "Off (press r to refresh)"
};
var LANGUAGE_NAMES = { zh: "\u7B80\u4F53\u4E2D\u6587", en: "English" };
function words(language = "zh") {
  return language === "zh" ? zh : en;
}

// src/native/settings.ts
var DEFAULT_SETTINGS = {
  language: "zh",
  refresh: 5,
  scope: "current",
  filter: "all",
  sort: "created",
  time: "relative"
};
var LANGUAGES = ["zh", "en"];
var REFRESH_CHOICES = [5, 10, 30, 60, 0];
var SCOPES = ["current", "all"];
var FILTERS = ["all", "active", "paused", "done"];
var SORTS = ["created", "next", "name"];
var TIME_FORMATS = ["relative", "absolute"];
var pick = (choices, value, fallback) => choices.includes(value) ? value : fallback;
function normalizeSettings(value) {
  return {
    language: pick(LANGUAGES, value?.language, DEFAULT_SETTINGS.language),
    refresh: pick(REFRESH_CHOICES, value?.refresh, DEFAULT_SETTINGS.refresh),
    scope: pick(SCOPES, value?.scope, DEFAULT_SETTINGS.scope),
    filter: pick(FILTERS, value?.filter, DEFAULT_SETTINGS.filter),
    sort: pick(SORTS, value?.sort, DEFAULT_SETTINGS.sort),
    time: pick(TIME_FORMATS, value?.time, DEFAULT_SETTINGS.time)
  };
}

// src/native/window.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

// src/native/format.ts
var STATUS_GLYPHS = { active: "\u25CF", paused: "\u2016", done: "\u2713" };
var WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
function charColumns(char) {
  return WIDE.test(char) ? 2 : 1;
}
function columns(text) {
  let total = 0;
  for (const char of text)
    total += charColumns(char);
  return total;
}
function fit(text, width, align = "left") {
  if (width <= 0)
    return "";
  let used = 0;
  let out = "";
  if (columns(text) > width) {
    for (const char of text) {
      const size = charColumns(char);
      if (used + size > width - 1)
        break;
      out += char;
      used += size;
    }
    out += "\u2026";
    used += 1;
  } else {
    out = text;
    used = columns(text);
  }
  const pad = " ".repeat(Math.max(0, width - used));
  return align === "right" ? pad + out : out + pad;
}
var pad2 = (value) => String(value).padStart(2, "0");
function dayDiff(value, now) {
  const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(value) - start(now)) / 86400000);
}
function clockTime(ms, now = Date.now(), language = "zh") {
  if (ms === undefined)
    return "\u2014";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()))
    return "\u2014";
  const current = new Date(now);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const days = dayDiff(date, current);
  const text = words(language);
  if (days === 0)
    return `${text.today} ${time}`;
  if (days === 1)
    return `${text.tomorrow} ${time}`;
  if (days === -1)
    return `${text.yesterday} ${time}`;
  const day = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return date.getFullYear() === current.getFullYear() ? `${day} ${time}` : `${date.getFullYear()}-${day} ${time}`;
}
function relativeTime(ms, now = Date.now(), language = "zh") {
  if (ms === undefined)
    return "\u2014";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const text = words(language);
  if (abs < 60000)
    return diff >= 0 ? text.soon : text.justNow;
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const [value, unit] = minutes < 60 ? [minutes, "minute"] : hours < 24 ? [hours, "hour"] : [Math.round(abs / 86400000), "day"];
  return text.relative(value, unit, diff >= 0);
}
function nextLabel(row, now = Date.now(), language = "zh", format = "relative") {
  const text = words(language);
  if (row.status === "done")
    return text.statuses.done;
  if (row.status === "paused")
    return text.statuses.paused;
  if (row.nextDueAt !== undefined)
    return format === "absolute" ? clockTime(row.nextDueAt, now, language) : relativeTime(row.nextDueAt, now, language);
  return row.trigger?.type === "event" ? text.onEvent : "\u2014";
}

// src/native/window.tsx
var RAIL_WIDTH = 16;
var WIDE2 = 110;
var NEXT_WIDTH = {
  relative: {
    zh: 10,
    en: 13
  },
  absolute: {
    zh: 16,
    en: 16
  }
};
var WHEN_WIDTH = 20;
var LABEL_WIDTH = 8;
var HINT_GAP = "  ";
var OUTPUT_LIMIT = 4000;
var ACTION_GLYPHS = {
  shell: "$",
  code: "\u03BB",
  subagent: "\u21B3"
};
function reconcileWindowSelection(rows, id, previousIndex = 0) {
  return rows.find((row) => row.id === id)?.id ?? rows[Math.max(0, Math.min(previousIndex, rows.length - 1))]?.id;
}
function keyHintLines(hints, width) {
  const lines = [];
  let used = 0;
  for (const hint of hints) {
    const size = columns(`${hint.key} ${hint.label}`);
    const last = lines.at(-1);
    if (last && used + HINT_GAP.length + size <= width) {
      last.push(hint);
      used += HINT_GAP.length + size;
    } else {
      lines.push([hint]);
      used = size;
    }
  }
  return lines;
}
function AutomationWindow(props) {
  const language = () => props.language?.() ?? "zh";
  const text = () => words(language());
  const describeTrigger = (trigger) => {
    switch (trigger.type) {
      case "at": {
        const ms = Date.parse(trigger.at);
        return text().whenAt(Number.isNaN(ms) ? trigger.at : clockTime(ms, now(), language()));
      }
      case "every":
        return text().whenEvery(trigger.every);
      case "cron":
        return `Cron ${trigger.cron}`;
      case "event":
        return text().whenEvent(trigger.server, trigger.event);
    }
  };
  const terminal = useTerminalDimensions();
  const [width, setWidth] = createSignal(Math.max(20, terminal().width - 4));
  const [filter, setFilter] = createSignal(props.initialFilter ?? "all");
  const [scope, setScope] = createSignal(props.currentSessionID() ? props.initialScope ?? "current" : "all");
  const [query, setQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [selectedID, setSelectedID] = createSignal();
  const [pending, setPending] = createSignal(false);
  const [actionError, setActionError] = createSignal();
  const [now, setNow] = createSignal(Date.now());
  const [hasKeyboard, setHasKeyboard] = createSignal(false);
  let root;
  let list;
  let detail;
  let previousIndex = 0;
  let alive = true;
  const theme = props.theme;
  const faint = () => theme().faint ?? theme().muted;
  const wide = () => width() >= WIDE2;
  const detailWidth = () => wide() ? Math.min(60, Math.max(40, Math.floor(width() * 0.4))) : width();
  const listWidth = () => wide() ? width() - RAIL_WIDTH - 1 - detailWidth() : width();
  const rowWidth = () => listWidth() - 2;
  const whenWidth = () => rowWidth() >= 56 ? WHEN_WIDTH : 0;
  const timeFormat = () => props.timeFormat?.() ?? "relative";
  const nextWidth = () => NEXT_WIDTH[timeFormat()][language()];
  const nameWidth = () => Math.max(6, rowWidth() - 2 - nextWidth() - 2 - (whenWidth() ? whenWidth() + 2 : 0));
  const scoped = createMemo(() => scope() === "all" ? props.rows() : props.rows().filter((row) => belongsTo(row, props.currentSessionID())));
  const counts = createMemo(() => countAutomations(scoped()));
  const visible = createMemo(() => sortAutomations(selectAutomations(scoped(), {
    status: filter(),
    query: query()
  }), props.sort?.() ?? "created", language() === "zh" ? "zh-CN" : "en"));
  const selected = createMemo(() => visible().find((row) => row.id === selectedID()));
  const busy = () => pending() || props.loading();
  createEffect(() => {
    const rows = visible();
    const id = reconcileWindowSelection(rows, selectedID(), previousIndex);
    if (selectedID() !== id)
      setSelectedID(id);
    previousIndex = Math.max(0, rows.findIndex((row) => row.id === id));
  });
  createEffect(() => {
    const id = selectedID();
    detail?.scrollTo(0);
    if (id)
      queueMicrotask(() => {
        if (alive)
          list?.scrollChildIntoView(`automation-row-${id}`);
      });
  });
  const clock = setInterval(() => setNow(Date.now()), 30000);
  onCleanup(() => {
    alive = false;
    clearInterval(clock);
  });
  async function invoke(action) {
    if (busy())
      return;
    setPending(true);
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      if (alive)
        setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (alive)
        setPending(false);
    }
  }
  const exitSearch = () => {
    setSearching(false);
    root?.focus();
  };
  const close = () => {
    Promise.resolve().then(() => props.close()).catch((error) => {
      if (alive)
        setActionError(String(error));
    });
  };
  const escape = () => {
    if (helping())
      setHelping(false);
    else if (query())
      setQuery("");
    else
      close();
  };
  const switchFilter = (delta) => setFilter(FILTERS[(FILTERS.indexOf(filter()) + delta + FILTERS.length) % FILTERS.length]);
  function move(delta) {
    const rows = visible();
    const index = rows.findIndex((row) => row.id === selectedID());
    setSelectedID(rows[Math.max(0, Math.min(rows.length - 1, index + delta))]?.id);
  }
  function toggle() {
    const row = selected();
    if (row?.status === "active")
      invoke(() => props.pause(row));
    if (row?.status === "paused")
      invoke(() => props.resume(row));
  }
  const remove = () => {
    const row = selected();
    if (row)
      invoke(() => props.remove(row));
  };
  const open = () => {
    const row = selected();
    if (row && targetSessionID(row))
      invoke(() => props.openSession(row));
  };
  const settings = () => {
    if (props.openSettings)
      invoke(() => props.openSettings());
  };
  const [helping, setHelping] = createSignal(false);
  const toggleHelp = () => {
    setHelping(!helping());
    detail?.scrollTo(0);
  };
  const actions = [{
    key: "up",
    run: () => move(-1)
  }, {
    key: "k",
    run: () => move(-1)
  }, {
    key: "down",
    run: () => move(1)
  }, {
    key: "j",
    run: () => move(1)
  }, {
    key: "left",
    run: () => switchFilter(-1)
  }, {
    key: "right",
    run: () => switchFilter(1)
  }, {
    key: "tab",
    run: () => switchFilter(1)
  }, {
    key: "shift+tab",
    run: () => switchFilter(-1)
  }, {
    key: "/",
    run: () => setSearching(true)
  }, {
    key: "s",
    run: () => setScope(scope() === "all" ? "current" : "all")
  }, {
    key: "escape",
    run: escape
  }, {
    key: "r",
    run: () => {
      invoke(props.refresh);
    }
  }, {
    key: "p",
    run: toggle
  }, {
    key: "d",
    run: remove
  }, {
    key: "o",
    run: open
  }, {
    key: "c",
    run: settings
  }, {
    key: "h",
    run: toggleHelp
  }, {
    key: "pageup",
    run: () => detail?.scrollBy(-Math.max(1, detail.height - 1))
  }, {
    key: "pagedown",
    run: () => detail?.scrollBy(Math.max(1, detail.height - 1))
  }].map((action) => ({
    ...action,
    run: () => {
      if (!searching())
        action.run();
    }
  }));
  onMount(() => {
    root?.focus();
    const unbind = props.bindKeys?.(() => searching() ? undefined : root, actions);
    if (unbind)
      onCleanup(unbind);
  });
  function onKey(key) {
    if (props.bindKeys || searching() || key.ctrl || key.meta || key.option)
      return;
    const name = key.name === "tab" && key.shift ? "shift+tab" : key.name;
    const action = actions.find((action) => action.key === name || action.key === "/" && key.sequence === "/");
    if (action) {
      key.preventDefault();
      key.stopPropagation();
      action.run();
    }
  }
  const statusColor = (status) => status === "active" ? theme().success : status === "paused" ? theme().warning : theme().muted;
  const actionKind = (action) => action.type === "prompt" ? action.to.subagent ? "subagent" : undefined : action.type;
  const actionColor = (action) => {
    const kind = actionKind(action);
    return kind === "shell" ? theme().warning : kind === "code" ? theme().info : theme().accent;
  };
  const pickFilter = (value) => {
    setFilter(value);
    root?.focus();
  };
  const title = (row) => row.name || actionBody(row.action).replace(/\s+/g, " ").trim() || row.id;
  const sessionName = (session) => session?.title || session?.id;
  const Tab = (tab) => (() => {
    var _el$ = _$createElement("text");
    _$setProp(_el$, "wrapMode", "none");
    _$setProp(_el$, "selectable", false);
    _$setProp(_el$, "flexShrink", 0);
    _$setProp(_el$, "onMouseUp", () => {
      tab.run();
      root?.focus();
    });
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!tab.active);
      return () => _c$() ? (() => {
        var _el$2 = _$createElement("b");
        _$insert(_el$2, () => ` ${tab.label} `);
        return _el$2;
      })() : ` ${tab.label} `;
    })());
    _$effect((_p$) => {
      var _v$ = tab.active ? theme().accent : theme().muted, _v$2 = tab.active ? theme().raised : undefined;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "bg", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
  const Field = (field) => (() => {
    var _el$3 = _$createElement("text"), _el$4 = _$createElement("span"), _el$5 = _$createElement("span");
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$5);
    _$setProp(_el$3, "wrapMode", "word");
    _$setProp(_el$3, "flexShrink", 0);
    _$insert(_el$4, () => fit(field.label, language() === "en" ? 11 : LABEL_WIDTH + 2));
    _$insert(_el$5, () => field.children);
    _$effect((_p$) => {
      var _v$3 = {
        fg: theme().muted
      }, _v$4 = {
        fg: field.color ?? theme().text
      };
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$4, "style", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$5, "style", _v$4, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$3;
  })();
  const Button = (button) => (() => {
    var _el$6 = _$createElement("text"), _el$7 = _$createElement("b"), _el$8 = _$createElement("span");
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$6, _el$8);
    _$setProp(_el$6, "wrapMode", "none");
    _$setProp(_el$6, "selectable", false);
    _$setProp(_el$6, "flexShrink", 0);
    _$insert(_el$7, () => ` ${button.hotkey}`);
    _$insert(_el$8, () => ` ${button.label} `);
    _$effect((_p$) => {
      var _v$5 = theme().raised, _v$6 = button.run, _v$7 = {
        fg: button.color
      }, _v$8 = {
        fg: theme().text
      };
      _v$5 !== _p$.e && (_p$.e = _$setProp(_el$6, "bg", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp(_el$6, "onMouseUp", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp(_el$7, "style", _v$7, _p$.a));
      _v$8 !== _p$.o && (_p$.o = _$setProp(_el$8, "style", _v$8, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$6;
  })();
  const hints = () => {
    if (searching())
      return [{
        key: "enter",
        label: text().done
      }, {
        key: "esc",
        label: text().backToList
      }];
    if (!hasKeyboard())
      return [{
        key: text().clickWindow,
        label: text().keyboardElsewhere
      }, {
        key: "/automation_status",
        label: text().close
      }];
    const row = selected();
    return [{
      key: "\u2191\u2193",
      label: text().select
    }, {
      key: wide() ? "tab" : "\u2190\u2192",
      label: text().status
    }, {
      key: "s",
      label: scope() === "all" ? text().onlyCurrent : text().allSessions
    }, {
      key: "/",
      label: text().search
    }, {
      key: "r",
      label: text().refresh
    }, ...row?.status === "active" ? [{
      key: "p",
      label: text().pause
    }] : row?.status === "paused" ? [{
      key: "p",
      label: text().resume
    }] : [], ...row ? [{
      key: "d",
      label: text().remove
    }] : [], ...row && targetSessionID(row) ? [{
      key: "o",
      label: text().openSession
    }] : [], ...props.openSettings ? [{
      key: "c",
      label: text().settings
    }] : [], {
      key: helping() ? "h/esc" : "h",
      label: helping() ? text().helpClose : text().help
    }, ...helping() ? [] : [{
      key: "esc",
      label: query() ? text().clearSearch : text().close
    }]];
  };
  const notice = () => {
    const failure = actionError() || props.error();
    if (failure)
      return {
        text: `\u2715 ${failure}`,
        color: theme().error
      };
  };
  const emptyText = () => props.loading() ? text().reading : props.error() ? text().readFailed : scope() === "current" && !props.currentSessionID() ? text().noCurrent : query() || filter() !== "all" ? text().noMatches : scope() === "current" ? text().noSessionTasks : text().noTasks;
  const Rail = () => (() => {
    var _el$9 = _$createElement("box"), _el$0 = _$createElement("text");
    _$insertNode(_el$9, _el$0);
    _$setProp(_el$9, "width", 16);
    _$setProp(_el$9, "flexShrink", 0);
    _$setProp(_el$9, "flexDirection", "column");
    _$setProp(_el$9, "border", ["right"]);
    _$setProp(_el$0, "wrapMode", "none");
    _$setProp(_el$0, "flexShrink", 0);
    _$insert(_el$0, () => `  ${text().status}`);
    _$insert(_el$9, _$createComponent(For, {
      each: FILTERS,
      children: (item) => {
        const chosen = () => filter() === item;
        return (() => {
          var _el$1 = _$createElement("text");
          _$setProp(_el$1, "height", 1);
          _$setProp(_el$1, "flexShrink", 0);
          _$setProp(_el$1, "wrapMode", "none");
          _$setProp(_el$1, "selectable", false);
          _$setProp(_el$1, "onMouseUp", () => pickFilter(item));
          _$insert(_el$1, () => `${chosen() ? "\u203A" : " "} ${fit(text().statuses[item], 8)}${fit(String(counts()[item]), RAIL_WIDTH - 12, "right")} `);
          _$effect((_p$) => {
            var _v$1 = chosen() ? theme().accent : theme().muted, _v$10 = chosen() ? theme().raised : undefined;
            _v$1 !== _p$.e && (_p$.e = _$setProp(_el$1, "fg", _v$1, _p$.e));
            _v$10 !== _p$.t && (_p$.t = _$setProp(_el$1, "bg", _v$10, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$1;
        })();
      }
    }), null);
    _$effect((_p$) => {
      var _v$9 = theme().border, _v$0 = faint();
      _v$9 !== _p$.e && (_p$.e = _$setProp(_el$9, "borderColor", _v$9, _p$.e));
      _v$0 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$0, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$9;
  })();
  const List = () => (() => {
    var _el$10 = _$createElement("box"), _el$11 = _$createElement("text"), _el$12 = _$createElement("scrollbox");
    _$insertNode(_el$10, _el$11);
    _$insertNode(_el$10, _el$12);
    _$setProp(_el$10, "flexDirection", "column");
    _$setProp(_el$10, "flexShrink", 0);
    _$setProp(_el$10, "minHeight", 0);
    _$setProp(_el$11, "wrapMode", "none");
    _$setProp(_el$11, "flexShrink", 0);
    _$insert(_el$11, () => `  ${fit(text().task, nameWidth())}  ${whenWidth() ? `${fit(text().plan, whenWidth())}  ` : ""}${fit(text().next, nextWidth(), "right")}`);
    var _ref$ = list;
    typeof _ref$ === "function" ? _$use(_ref$, _el$12) : list = _el$12;
    _$setProp(_el$12, "id", "automation-list");
    _$setProp(_el$12, "flexGrow", 1);
    _$setProp(_el$12, "flexBasis", 0);
    _$setProp(_el$12, "minHeight", 0);
    _$setProp(_el$12, "scrollX", false);
    _$insert(_el$12, _$createComponent(Show, {
      get when() {
        return visible().length;
      },
      get fallback() {
        return (() => {
          var _el$13 = _$createElement("text");
          _$setProp(_el$13, "wrapMode", "word");
          _$setProp(_el$13, "marginTop", 1);
          _$insert(_el$13, () => `  ${emptyText()}`);
          _$effect((_$p) => _$setProp(_el$13, "fg", theme().muted, _$p));
          return _el$13;
        })();
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return visible();
          },
          children: (row) => {
            const chosen = () => selectedID() === row.id;
            const marker = () => {
              const kind = actionKind(row.action);
              return kind ? `${ACTION_GLYPHS[kind]} ` : "";
            };
            const failed = () => row.status !== "done" && row.lastOutcome === "failed" ? ` ${text().failedTag}` : "";
            const room = () => nameWidth() - columns(marker()) - columns(failed());
            const name = () => fit(title(row), room()).trimEnd();
            const pad = () => " ".repeat(Math.max(0, room() - columns(name())));
            return (() => {
              var _el$14 = _$createElement("box"), _el$15 = _$createElement("text"), _el$16 = _$createElement("span"), _el$17 = _$createElement("span"), _el$18 = _$createElement("span"), _el$19 = _$createElement("span"), _el$20 = _$createElement("span"), _el$21 = _$createElement("span");
              _$insertNode(_el$14, _el$15);
              _$setProp(_el$14, "height", 1);
              _$setProp(_el$14, "flexShrink", 0);
              _$setProp(_el$14, "onMouseUp", () => {
                setSelectedID(row.id);
                root?.focus();
              });
              _$insertNode(_el$15, _el$16);
              _$insertNode(_el$15, _el$17);
              _$insertNode(_el$15, _el$18);
              _$insertNode(_el$15, _el$19);
              _$insertNode(_el$15, _el$20);
              _$insertNode(_el$15, _el$21);
              _$setProp(_el$15, "wrapMode", "none");
              _$setProp(_el$15, "selectable", false);
              _$insert(_el$16, () => `${STATUS_GLYPHS[row.status]} `);
              _$insert(_el$17, marker);
              _$insert(_el$15, (() => {
                var _c$2 = _$memo(() => !!chosen());
                return () => _c$2() ? (() => {
                  var _el$22 = _$createElement("b");
                  _$insert(_el$22, name);
                  _$effect((_$p) => _$setProp(_el$22, "style", {
                    fg: theme().accent
                  }, _$p));
                  return _el$22;
                })() : (() => {
                  var _el$23 = _$createElement("span");
                  _$insert(_el$23, name);
                  _$effect((_$p) => _$setProp(_el$23, "style", {
                    fg: row.status === "done" ? theme().muted : theme().text
                  }, _$p));
                  return _el$23;
                })();
              })(), _el$18);
              _$insert(_el$18, failed);
              _$insert(_el$19, pad);
              _$insert(_el$20, (() => {
                var _c$3 = _$memo(() => !!whenWidth());
                return () => _c$3() ? `  ${fit(describeTrigger(row.trigger), whenWidth())}` : "";
              })());
              _$insert(_el$21, () => `  ${fit(nextLabel(row, now(), language(), timeFormat()), nextWidth(), "right")}`);
              _$effect((_p$) => {
                var _v$15 = `automation-row-${row.id}`, _v$16 = chosen() ? theme().raised : undefined, _v$17 = {
                  fg: statusColor(row.status)
                }, _v$18 = {
                  fg: actionColor(row.action)
                }, _v$19 = {
                  fg: theme().error
                }, _v$20 = {
                  fg: theme().muted
                }, _v$21 = {
                  fg: theme().muted
                }, _v$22 = {
                  fg: row.status === "active" ? theme().text : faint()
                };
                _v$15 !== _p$.e && (_p$.e = _$setProp(_el$14, "id", _v$15, _p$.e));
                _v$16 !== _p$.t && (_p$.t = _$setProp(_el$14, "backgroundColor", _v$16, _p$.t));
                _v$17 !== _p$.a && (_p$.a = _$setProp(_el$16, "style", _v$17, _p$.a));
                _v$18 !== _p$.o && (_p$.o = _$setProp(_el$17, "style", _v$18, _p$.o));
                _v$19 !== _p$.i && (_p$.i = _$setProp(_el$18, "style", _v$19, _p$.i));
                _v$20 !== _p$.n && (_p$.n = _$setProp(_el$19, "style", _v$20, _p$.n));
                _v$21 !== _p$.s && (_p$.s = _$setProp(_el$20, "style", _v$21, _p$.s));
                _v$22 !== _p$.h && (_p$.h = _$setProp(_el$21, "style", _v$22, _p$.h));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined,
                i: undefined,
                n: undefined,
                s: undefined,
                h: undefined
              });
              return _el$14;
            })();
          }
        });
      }
    }));
    _$effect((_p$) => {
      var _v$11 = wide() ? listWidth() : "100%", _v$12 = wide() ? "100%" : "45%", _v$13 = wide() ? 1 : 0, _v$14 = faint();
      _v$11 !== _p$.e && (_p$.e = _$setProp(_el$10, "width", _v$11, _p$.e));
      _v$12 !== _p$.t && (_p$.t = _$setProp(_el$10, "height", _v$12, _p$.t));
      _v$13 !== _p$.a && (_p$.a = _$setProp(_el$10, "paddingLeft", _v$13, _p$.a));
      _v$14 !== _p$.o && (_p$.o = _$setProp(_el$11, "fg", _v$14, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$10;
  })();
  const output = (value) => value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\u2026` : value;
  const Help = () => {
    const keyWidth = () => Math.max(...text().helpSections.flatMap((section) => section.items.map(([key]) => columns(key)))) + 2;
    return (() => {
      var _el$24 = _$createElement("box"), _el$25 = _$createElement("text"), _el$26 = _$createElement("b");
      _$insertNode(_el$24, _el$25);
      _$setProp(_el$24, "id", "automation-help");
      _$setProp(_el$24, "flexDirection", "column");
      _$setProp(_el$24, "flexShrink", 0);
      _$insertNode(_el$25, _el$26);
      _$setProp(_el$25, "flexShrink", 0);
      _$insert(_el$26, () => text().helpTitle);
      _$insert(_el$24, _$createComponent(For, {
        get each() {
          return text().helpSections;
        },
        children: (section) => [(() => {
          var _el$27 = _$createElement("box");
          _$setProp(_el$27, "height", 1);
          _$setProp(_el$27, "flexShrink", 0);
          return _el$27;
        })(), (() => {
          var _el$28 = _$createElement("text");
          _$setProp(_el$28, "flexShrink", 0);
          _$insert(_el$28, () => section.title);
          _$effect((_$p) => _$setProp(_el$28, "fg", theme().muted, _$p));
          return _el$28;
        })(), _$createComponent(For, {
          get each() {
            return section.items;
          },
          children: ([key, value]) => (() => {
            var _el$29 = _$createElement("box"), _el$30 = _$createElement("text"), _el$31 = _$createElement("text");
            _$insertNode(_el$29, _el$30);
            _$insertNode(_el$29, _el$31);
            _$setProp(_el$29, "flexDirection", "row");
            _$setProp(_el$29, "flexShrink", 0);
            _$setProp(_el$30, "wrapMode", "none");
            _$setProp(_el$30, "flexShrink", 0);
            _$insert(_el$30, key);
            _$setProp(_el$31, "wrapMode", "word");
            _$setProp(_el$31, "flexGrow", 1);
            _$setProp(_el$31, "flexShrink", 1);
            _$setProp(_el$31, "minWidth", 0);
            _$insert(_el$31, value);
            _$effect((_p$) => {
              var _v$23 = theme().accent, _v$24 = keyWidth(), _v$25 = theme().text;
              _v$23 !== _p$.e && (_p$.e = _$setProp(_el$30, "fg", _v$23, _p$.e));
              _v$24 !== _p$.t && (_p$.t = _$setProp(_el$30, "width", _v$24, _p$.t));
              _v$25 !== _p$.a && (_p$.a = _$setProp(_el$31, "fg", _v$25, _p$.a));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined
            });
            return _el$29;
          })()
        })]
      }), null);
      _$effect((_$p) => _$setProp(_el$25, "fg", theme().text, _$p));
      return _el$24;
    })();
  };
  const Detail = (detailProps) => {
    const row = () => detailProps.row;
    const action = () => row().action;
    const sendTo = () => {
      const current = action();
      if (current.type !== "prompt" || current.to.subagent || current.to.session === row().sessionID)
        return;
      return sessionName(row().target) || current.to.session;
    };
    const subagent = () => {
      const current = action();
      return current.type === "prompt" ? current.to.subagent : undefined;
    };
    const eventArgs = () => {
      const trigger = row().trigger;
      return trigger.type === "event" && trigger.args && Object.keys(trigger.args).length ? JSON.stringify(trigger.args) : undefined;
    };
    const wake = () => {
      const value = codeWake(row());
      return value ? ` \xB7 ${text().wakes[value]}` : "";
    };
    const state = () => {
      const value = row().state;
      return value === undefined || value === null ? undefined : JSON.stringify(value, null, 2);
    };
    return (() => {
      var _el$32 = _$createElement("box"), _el$33 = _$createElement("text"), _el$34 = _$createElement("b"), _el$35 = _$createElement("text"), _el$36 = _$createElement("span"), _el$37 = _$createElement("span"), _el$38 = _$createElement("box"), _el$39 = _$createElement("box"), _el$40 = _$createElement("text"), _el$41 = _$createElement("span"), _el$42 = _$createElement("span"), _el$43 = _$createElement("box"), _el$44 = _$createElement("text"), _el$45 = _$createElement("box"), _el$46 = _$createElement("text"), _el$47 = _$createElement("text"), _el$48 = _$createElement("text"), _el$49 = _$createElement("box"), _el$50 = _$createElement("box"), _el$51 = _$createElement("box"), _el$52 = _$createElement("text"), _el$53 = _$createElement("text");
      _$insertNode(_el$32, _el$33);
      _$insertNode(_el$32, _el$35);
      _$insertNode(_el$32, _el$38);
      _$insertNode(_el$32, _el$39);
      _$insertNode(_el$32, _el$40);
      _$insertNode(_el$32, _el$43);
      _$insertNode(_el$32, _el$45);
      _$insertNode(_el$32, _el$46);
      _$insertNode(_el$32, _el$47);
      _$insertNode(_el$32, _el$48);
      _$insertNode(_el$32, _el$49);
      _$insertNode(_el$32, _el$50);
      _$insertNode(_el$32, _el$51);
      _$insertNode(_el$32, _el$52);
      _$insertNode(_el$32, _el$53);
      _$setProp(_el$32, "flexDirection", "column");
      _$setProp(_el$32, "flexShrink", 0);
      _$insertNode(_el$33, _el$34);
      _$setProp(_el$33, "wrapMode", "word");
      _$setProp(_el$33, "flexShrink", 0);
      _$insert(_el$34, () => title(row()));
      _$insertNode(_el$35, _el$36);
      _$insertNode(_el$35, _el$37);
      _$setProp(_el$35, "wrapMode", "none");
      _$setProp(_el$35, "flexShrink", 0);
      _$insert(_el$36, () => `${STATUS_GLYPHS[row().status]} ${text().statuses[row().status]}`);
      _$insert(_el$37, () => `  \xB7  ${describeTrigger(row().trigger)}`);
      _$setProp(_el$38, "height", 1);
      _$setProp(_el$38, "flexShrink", 0);
      _$insert(_el$32, _$createComponent(Field, {
        get label() {
          return text().next;
        },
        get children() {
          return _$memo(() => !!(row().status === "active" && row().nextDueAt !== undefined))() ? text().nextTime(clockTime(row().nextDueAt, now(), language()), relativeTime(row().nextDueAt, now(), language())) : _$memo(() => row().status === "paused")() ? text().pausedNext : _$memo(() => row().status === "done")() ? text().noMoreRuns : _$memo(() => row().trigger.type === "event")() ? text().onEvent : "\u2014";
        }
      }), _el$39);
      _$insert(_el$32, _$createComponent(Show, {
        get when() {
          return eventArgs();
        },
        children: (args) => _$createComponent(Field, {
          get label() {
            return text().eventArgs;
          },
          get children() {
            return args();
          }
        })
      }), _el$39);
      _$insert(_el$32, _$createComponent(Field, {
        get label() {
          return text().timeZone;
        },
        get children() {
          return row().tz;
        }
      }), _el$39);
      _$insert(_el$32, _$createComponent(Field, {
        get label() {
          return text().ends;
        },
        get children() {
          return _$memo(() => row().expires !== undefined)() ? clockTime(row().expires, now(), language()) : text().unlimited;
        }
      }), _el$39);
      _$insert(_el$32, _$createComponent(Field, {
        get label() {
          return text().runs;
        },
        get children() {
          return text().runCount(row().runCount);
        }
      }), _el$39);
      _$insert(_el$32, _$createComponent(Field, {
        get label() {
          return text().last;
        },
        get color() {
          return _$memo(() => row().lastOutcome === "failed")() ? theme().error : undefined;
        },
        get children() {
          return _$memo(() => row().lastRunAt !== undefined)() ? `${clockTime(row().lastRunAt, now(), language())}${row().lastOutcome ? ` \xB7 ${text().outcomes[row().lastOutcome]}` : ""}${wake()}` : _$memo(() => !!row().lastOutcome)() ? `${text().outcomes[row().lastOutcome]}${wake()}` : text().neverFired;
        }
      }), _el$39);
      _$setProp(_el$39, "height", 1);
      _$setProp(_el$39, "flexShrink", 0);
      _$insertNode(_el$40, _el$41);
      _$insertNode(_el$40, _el$42);
      _$setProp(_el$40, "flexShrink", 0);
      _$insert(_el$41, () => `${text().action}  `);
      _$insert(_el$42, () => text().actions[actionKind(action()) ?? "prompt"]);
      _$insert(_el$40, _$createComponent(Show, {
        get when() {
          return subagent();
        },
        children: (agent) => (() => {
          var _el$54 = _$createElement("span");
          _$insert(_el$54, () => ` ${agent()}`);
          _$effect((_$p) => _$setProp(_el$54, "style", {
            fg: theme().text
          }, _$p));
          return _el$54;
        })()
      }), null);
      _$insertNode(_el$43, _el$44);
      _$setProp(_el$43, "flexShrink", 0);
      _$setProp(_el$43, "border", ["left"]);
      _$setProp(_el$43, "paddingLeft", 1);
      _$setProp(_el$43, "marginTop", 0);
      _$setProp(_el$44, "wrapMode", "word");
      _$insert(_el$44, () => actionBody(action()).trim() || "\u2014");
      _$insert(_el$32, _$createComponent(Show, {
        get when() {
          return sendTo();
        },
        children: (value) => _$createComponent(Field, {
          get label() {
            return text().sendTo;
          },
          get children() {
            return value();
          }
        })
      }), _el$45);
      _$insert(_el$32, _$createComponent(Show, {
        get when() {
          return row().lastOutput;
        },
        children: (value) => [(() => {
          var _el$55 = _$createElement("box");
          _$setProp(_el$55, "height", 1);
          _$setProp(_el$55, "flexShrink", 0);
          return _el$55;
        })(), (() => {
          var _el$56 = _$createElement("text");
          _$setProp(_el$56, "flexShrink", 0);
          _$insert(_el$56, () => text().lastOutput);
          _$effect((_$p) => _$setProp(_el$56, "fg", theme().muted, _$p));
          return _el$56;
        })(), (() => {
          var _el$57 = _$createElement("box"), _el$58 = _$createElement("text");
          _$insertNode(_el$57, _el$58);
          _$setProp(_el$57, "flexShrink", 0);
          _$setProp(_el$57, "border", ["left"]);
          _$setProp(_el$57, "paddingLeft", 1);
          _$setProp(_el$58, "wrapMode", "word");
          _$insert(_el$58, () => output(value()));
          _$effect((_p$) => {
            var _v$38 = row().lastOutcome === "failed" ? theme().error : theme().border, _v$39 = row().lastOutcome === "failed" ? theme().error : faint();
            _v$38 !== _p$.e && (_p$.e = _$setProp(_el$57, "borderColor", _v$38, _p$.e));
            _v$39 !== _p$.t && (_p$.t = _$setProp(_el$58, "fg", _v$39, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$57;
        })()]
      }), _el$45);
      _$insert(_el$32, _$createComponent(Show, {
        get when() {
          return state();
        },
        children: (value) => [(() => {
          var _el$59 = _$createElement("box");
          _$setProp(_el$59, "height", 1);
          _$setProp(_el$59, "flexShrink", 0);
          return _el$59;
        })(), (() => {
          var _el$60 = _$createElement("text");
          _$setProp(_el$60, "flexShrink", 0);
          _$insert(_el$60, () => text().savedState);
          _$effect((_$p) => _$setProp(_el$60, "fg", theme().muted, _$p));
          return _el$60;
        })(), (() => {
          var _el$61 = _$createElement("box"), _el$62 = _$createElement("text");
          _$insertNode(_el$61, _el$62);
          _$setProp(_el$61, "flexShrink", 0);
          _$setProp(_el$61, "border", ["left"]);
          _$setProp(_el$61, "paddingLeft", 1);
          _$setProp(_el$62, "wrapMode", "word");
          _$insert(_el$62, () => output(value()));
          _$effect((_p$) => {
            var _v$40 = theme().border, _v$41 = faint();
            _v$40 !== _p$.e && (_p$.e = _$setProp(_el$61, "borderColor", _v$40, _p$.e));
            _v$41 !== _p$.t && (_p$.t = _$setProp(_el$62, "fg", _v$41, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$61;
        })()]
      }), _el$45);
      _$setProp(_el$45, "height", 1);
      _$setProp(_el$45, "flexShrink", 0);
      _$setProp(_el$46, "flexShrink", 0);
      _$insert(_el$46, () => text().session);
      _$setProp(_el$47, "wrapMode", "word");
      _$setProp(_el$47, "flexShrink", 0);
      _$insert(_el$47, () => sessionName(row().session) || text().unknownSession);
      _$setProp(_el$48, "wrapMode", "word");
      _$setProp(_el$48, "flexShrink", 0);
      _$insert(_el$48, () => row().directory);
      _$setProp(_el$49, "height", 1);
      _$setProp(_el$49, "flexShrink", 0);
      _$setProp(_el$50, "flexDirection", "row");
      _$setProp(_el$50, "gap", 1);
      _$setProp(_el$50, "flexShrink", 0);
      _$setProp(_el$50, "flexWrap", "wrap");
      _$insert(_el$50, _$createComponent(Show, {
        get when() {
          return row().status !== "done";
        },
        get children() {
          return _$createComponent(Button, {
            hotkey: "p",
            get label() {
              return _$memo(() => row().status === "active")() ? text().pause : text().resume;
            },
            get color() {
              return theme().warning;
            },
            run: toggle
          });
        }
      }), null);
      _$insert(_el$50, _$createComponent(Button, {
        hotkey: "d",
        get label() {
          return text().remove;
        },
        get color() {
          return theme().error;
        },
        run: remove
      }), null);
      _$insert(_el$50, _$createComponent(Show, {
        get when() {
          return targetSessionID(row());
        },
        get children() {
          return _$createComponent(Button, {
            hotkey: "o",
            get label() {
              return text().openSession;
            },
            get color() {
              return theme().accent;
            },
            run: open
          });
        }
      }), null);
      _$setProp(_el$51, "height", 1);
      _$setProp(_el$51, "flexShrink", 0);
      _$setProp(_el$52, "wrapMode", "word");
      _$setProp(_el$52, "flexShrink", 0);
      _$insert(_el$52, () => `${text().automationID}: ${row().id}`);
      _$setProp(_el$53, "wrapMode", "word");
      _$setProp(_el$53, "flexShrink", 0);
      _$insert(_el$53, () => `${text().sessionID}: ${row().sessionID || "\u2014"}`);
      _$effect((_p$) => {
        var _v$26 = theme().text, _v$27 = {
          fg: statusColor(row().status)
        }, _v$28 = {
          fg: faint()
        }, _v$29 = {
          fg: theme().muted
        }, _v$30 = {
          fg: actionColor(action())
        }, _v$31 = actionColor(action()), _v$32 = theme().text, _v$33 = theme().muted, _v$34 = theme().text, _v$35 = faint(), _v$36 = faint(), _v$37 = faint();
        _v$26 !== _p$.e && (_p$.e = _$setProp(_el$33, "fg", _v$26, _p$.e));
        _v$27 !== _p$.t && (_p$.t = _$setProp(_el$36, "style", _v$27, _p$.t));
        _v$28 !== _p$.a && (_p$.a = _$setProp(_el$37, "style", _v$28, _p$.a));
        _v$29 !== _p$.o && (_p$.o = _$setProp(_el$41, "style", _v$29, _p$.o));
        _v$30 !== _p$.i && (_p$.i = _$setProp(_el$42, "style", _v$30, _p$.i));
        _v$31 !== _p$.n && (_p$.n = _$setProp(_el$43, "borderColor", _v$31, _p$.n));
        _v$32 !== _p$.s && (_p$.s = _$setProp(_el$44, "fg", _v$32, _p$.s));
        _v$33 !== _p$.h && (_p$.h = _$setProp(_el$46, "fg", _v$33, _p$.h));
        _v$34 !== _p$.r && (_p$.r = _$setProp(_el$47, "fg", _v$34, _p$.r));
        _v$35 !== _p$.d && (_p$.d = _$setProp(_el$48, "fg", _v$35, _p$.d));
        _v$36 !== _p$.l && (_p$.l = _$setProp(_el$52, "fg", _v$36, _p$.l));
        _v$37 !== _p$.u && (_p$.u = _$setProp(_el$53, "fg", _v$37, _p$.u));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined,
        r: undefined,
        d: undefined,
        l: undefined,
        u: undefined
      });
      return _el$32;
    })();
  };
  return (() => {
    var _el$63 = _$createElement("box"), _el$64 = _$createElement("box"), _el$65 = _$createElement("text"), _el$66 = _$createElement("b"), _el$67 = _$createElement("box"), _el$69 = _$createElement("text"), _el$76 = _$createElement("box"), _el$77 = _$createElement("scrollbox"), _el$78 = _$createElement("box");
    _$insertNode(_el$63, _el$64);
    _$insertNode(_el$63, _el$76);
    _$insertNode(_el$63, _el$78);
    _$use((box) => {
      root = box;
      box.on("focused", () => setHasKeyboard(true));
      box.on("blurred", () => setHasKeyboard(false));
      props.onRoot?.(box);
    }, _el$63);
    _$setProp(_el$63, "id", "native-automation-window");
    _$setProp(_el$63, "focusable", true);
    _$setProp(_el$63, "flexDirection", "column");
    _$setProp(_el$63, "flexShrink", 0);
    _$setProp(_el$63, "width", "100%");
    _$setProp(_el$63, "overflow", "hidden");
    _$setProp(_el$63, "border", true);
    _$setProp(_el$63, "borderStyle", "rounded");
    _$setProp(_el$63, "paddingLeft", 1);
    _$setProp(_el$63, "paddingRight", 1);
    _$setProp(_el$63, "onKeyDown", onKey);
    _$setProp(_el$63, "onSizeChange", function() {
      const measured = this.width - 4;
      if (measured > 0 && measured !== width())
        queueMicrotask(() => {
          if (alive)
            setWidth(measured);
        });
    });
    _$setProp(_el$63, "onMouseDown", () => {
      if (!searching())
        root?.focus();
    });
    _$insertNode(_el$64, _el$65);
    _$insertNode(_el$64, _el$67);
    _$insertNode(_el$64, _el$69);
    _$setProp(_el$64, "flexDirection", "row");
    _$setProp(_el$64, "flexShrink", 0);
    _$setProp(_el$64, "height", 1);
    _$setProp(_el$64, "gap", 1);
    _$insertNode(_el$65, _el$66);
    _$setProp(_el$65, "wrapMode", "none");
    _$setProp(_el$65, "flexShrink", 0);
    _$setProp(_el$65, "marginRight", 1);
    _$insert(_el$66, () => text().title);
    _$insert(_el$64, _$createComponent(For, {
      each: SCOPES,
      children: (item) => _$createComponent(Tab, {
        get label() {
          return item === "current" ? language() === "en" && !wide() ? "Current" : text().current : text().allSessions;
        },
        get active() {
          return scope() === item;
        },
        run: () => setScope(item)
      })
    }), _el$67);
    _$setProp(_el$67, "flexGrow", 1);
    _$insert(_el$64, _$createComponent(Show, {
      get when() {
        return busy();
      },
      get children() {
        var _el$68 = _$createElement("text");
        _$setProp(_el$68, "flexShrink", 0);
        _$insert(_el$68, (() => {
          var _c$4 = _$memo(() => !!props.loading());
          return () => _c$4() ? text().refreshing : text().processing;
        })());
        _$effect((_$p) => _$setProp(_el$68, "fg", theme().muted, _$p));
        return _el$68;
      }
    }), _el$69);
    _$insertNode(_el$69, _$createTextNode(`esc`));
    _$setProp(_el$69, "flexShrink", 0);
    _$setProp(_el$69, "selectable", false);
    _$setProp(_el$69, "onMouseUp", close);
    _$insert(_el$63, _$createComponent(Show, {
      get when() {
        return !wide();
      },
      get children() {
        var _el$71 = _$createElement("box");
        _$setProp(_el$71, "flexDirection", "row");
        _$setProp(_el$71, "flexShrink", 0);
        _$setProp(_el$71, "height", 1);
        _$insert(_el$71, _$createComponent(For, {
          each: FILTERS,
          children: (item) => _$createComponent(Tab, {
            get label() {
              return `${text().statuses[item]} ${counts()[item]}`;
            },
            get active() {
              return filter() === item;
            },
            run: () => pickFilter(item)
          })
        }));
        return _el$71;
      }
    }), _el$76);
    _$insert(_el$63, _$createComponent(Show, {
      get when() {
        return searching() || query();
      },
      get children() {
        var _el$72 = _$createElement("box"), _el$73 = _$createElement("text");
        _$insertNode(_el$72, _el$73);
        _$setProp(_el$72, "id", "automation-search-box");
        _$setProp(_el$72, "flexDirection", "row");
        _$setProp(_el$72, "height", 1);
        _$setProp(_el$72, "flexShrink", 0);
        _$setProp(_el$72, "marginTop", 1);
        _$setProp(_el$72, "onMouseUp", () => setSearching(true));
        _$insertNode(_el$73, _$createTextNode(`/ `));
        _$setProp(_el$73, "flexShrink", 0);
        _$insert(_el$72, _$createComponent(Show, {
          get when() {
            return searching();
          },
          get fallback() {
            return (() => {
              var _el$79 = _$createElement("text");
              _$setProp(_el$79, "wrapMode", "none");
              _$insert(_el$79, query);
              _$effect((_$p) => _$setProp(_el$79, "fg", theme().text, _$p));
              return _el$79;
            })();
          },
          get children() {
            var _el$75 = _$createElement("input");
            _$setProp(_el$75, "id", "automation-search");
            _$setProp(_el$75, "flexGrow", 1);
            _$setProp(_el$75, "onInput", setQuery);
            _$setProp(_el$75, "onKeyDown", (key) => {
              if (["escape", "return", "enter", "tab"].includes(key.name)) {
                key.preventDefault();
                key.stopPropagation();
                exitSearch();
              }
            });
            _$effect((_p$) => {
              var _v$42 = query(), _v$43 = searching(), _v$44 = text().searchPlaceholder, _v$45 = theme().text, _v$46 = theme().raised;
              _v$42 !== _p$.e && (_p$.e = _$setProp(_el$75, "value", _v$42, _p$.e));
              _v$43 !== _p$.t && (_p$.t = _$setProp(_el$75, "focused", _v$43, _p$.t));
              _v$44 !== _p$.a && (_p$.a = _$setProp(_el$75, "placeholder", _v$44, _p$.a));
              _v$45 !== _p$.o && (_p$.o = _$setProp(_el$75, "textColor", _v$45, _p$.o));
              _v$46 !== _p$.i && (_p$.i = _$setProp(_el$75, "backgroundColor", _v$46, _p$.i));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined,
              i: undefined
            });
            return _el$75;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$73, "fg", theme().accent, _$p));
        return _el$72;
      }
    }), _el$76);
    _$insert(_el$63, _$createComponent(Show, {
      get when() {
        return notice();
      },
      children: (item) => (() => {
        var _el$80 = _$createElement("text");
        _$setProp(_el$80, "flexShrink", 0);
        _$setProp(_el$80, "height", 1);
        _$setProp(_el$80, "marginTop", 1);
        _$setProp(_el$80, "wrapMode", "none");
        _$setProp(_el$80, "selectable", false);
        _$insert(_el$80, () => fit(item().text, width()));
        _$effect((_$p) => _$setProp(_el$80, "fg", item().color, _$p));
        return _el$80;
      })()
    }), _el$76);
    _$insertNode(_el$76, _el$77);
    _$setProp(_el$76, "flexGrow", 1);
    _$setProp(_el$76, "flexBasis", 0);
    _$setProp(_el$76, "minHeight", 0);
    _$setProp(_el$76, "marginTop", 1);
    _$setProp(_el$76, "overflow", "hidden");
    _$insert(_el$76, _$createComponent(Show, {
      get when() {
        return wide();
      },
      get children() {
        return _$createComponent(Rail, {});
      }
    }), _el$77);
    _$insert(_el$76, _$createComponent(List, {}), _el$77);
    var _ref$2 = detail;
    typeof _ref$2 === "function" ? _$use(_ref$2, _el$77) : detail = _el$77;
    _$setProp(_el$77, "id", "automation-detail");
    _$setProp(_el$77, "flexGrow", 1);
    _$setProp(_el$77, "flexBasis", 0);
    _$setProp(_el$77, "minWidth", 0);
    _$setProp(_el$77, "minHeight", 0);
    _$setProp(_el$77, "scrollX", false);
    _$setProp(_el$77, "paddingRight", 1);
    _$insert(_el$77, _$createComponent(Show, {
      get when() {
        return !helping();
      },
      get fallback() {
        return _$createComponent(Help, {});
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return selected();
          },
          get fallback() {
            return (() => {
              var _el$81 = _$createElement("text");
              _$setProp(_el$81, "wrapMode", "word");
              _$insert(_el$81, (() => {
                var _c$5 = _$memo(() => !!visible().length);
                return () => _c$5() ? text().selectTask : "";
              })());
              _$effect((_$p) => _$setProp(_el$81, "fg", faint(), _$p));
              return _el$81;
            })();
          },
          children: (row) => _$createComponent(Detail, {
            get row() {
              return row();
            }
          })
        });
      }
    }));
    _$setProp(_el$78, "id", "automation-footer");
    _$setProp(_el$78, "flexDirection", "column");
    _$setProp(_el$78, "flexShrink", 0);
    _$setProp(_el$78, "marginTop", 1);
    _$insert(_el$78, _$createComponent(For, {
      get each() {
        return keyHintLines(hints(), width());
      },
      children: (line) => (() => {
        var _el$82 = _$createElement("text");
        _$setProp(_el$82, "wrapMode", "none");
        _$setProp(_el$82, "selectable", false);
        _$insert(_el$82, () => line.flatMap((hint, index) => [...index ? [(() => {
          var _el$83 = _$createElement("span");
          _$insertNode(_el$83, _$createTextNode(`  `));
          _$effect((_$p) => _$setProp(_el$83, "style", {
            fg: theme().muted
          }, _$p));
          return _el$83;
        })()] : [], (() => {
          var _el$85 = _$createElement("b");
          _$insert(_el$85, () => hint.key);
          _$effect((_$p) => _$setProp(_el$85, "style", {
            fg: theme().text
          }, _$p));
          return _el$85;
        })(), (() => {
          var _el$86 = _$createElement("span");
          _$insert(_el$86, () => ` ${hint.label}`);
          _$effect((_$p) => _$setProp(_el$86, "style", {
            fg: theme().muted
          }, _$p));
          return _el$86;
        })()]));
        return _el$82;
      })()
    }));
    _$effect((_p$) => {
      var _v$47 = props.height ? props.height() ?? 20 : "100%", _v$48 = hasKeyboard() ? theme().accent : theme().border, _v$49 = theme().text, _v$50 = theme().muted, _v$51 = wide() ? "row" : "column", _v$52 = wide() ? ["left"] : ["top"], _v$53 = theme().border, _v$54 = wide() ? 2 : 0;
      _v$47 !== _p$.e && (_p$.e = _$setProp(_el$63, "height", _v$47, _p$.e));
      _v$48 !== _p$.t && (_p$.t = _$setProp(_el$63, "borderColor", _v$48, _p$.t));
      _v$49 !== _p$.a && (_p$.a = _$setProp(_el$65, "fg", _v$49, _p$.a));
      _v$50 !== _p$.o && (_p$.o = _$setProp(_el$69, "fg", _v$50, _p$.o));
      _v$51 !== _p$.i && (_p$.i = _$setProp(_el$76, "flexDirection", _v$51, _p$.i));
      _v$52 !== _p$.n && (_p$.n = _$setProp(_el$77, "border", _v$52, _p$.n));
      _v$53 !== _p$.s && (_p$.s = _$setProp(_el$77, "borderColor", _v$53, _p$.s));
      _v$54 !== _p$.h && (_p$.h = _$setProp(_el$77, "paddingLeft", _v$54, _p$.h));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined
    });
    return _el$63;
  })();
}

// src/native/tui.tsx
var id = "opencode-scheduler";
var tui_default = Plugin.define({
  id,
  setup(context) {
    const [stored, update] = context.storage.store("settings", {
      initial: {
        ...DEFAULT_SETTINGS
      }
    });
    const settings = () => normalizeSettings(stored);
    const language = () => settings().language;
    const text = () => words(language());
    const api = createAutomationClient(context.client, (sessionID) => context.data.session.get(sessionID));
    const [open, setOpen] = createSignal2(false);
    let windowBox;
    let focusBefore = null;
    function show() {
      const current = context.ui.router.current();
      if (current.type !== "session") {
        context.ui.toast.show({
          variant: "info",
          title: text().title,
          message: text().sessionRequired
        });
        return;
      }
      if (open())
        return hide();
      focusBefore = context.renderer.currentFocusedRenderable;
      setOpen(true);
      setTimeout(() => windowBox?.focus(), 50);
    }
    function hide() {
      setOpen(false);
      windowBox = undefined;
      if (focusBefore && !focusBefore.isDestroyed)
        focusBefore.focus();
      focusBefore = null;
    }
    const theme = () => ({
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
      info: context.theme.text.feedback.info.base
    });
    function choices(key) {
      const t = text();
      switch (key) {
        case "language":
          return LANGUAGES.map((value) => ({
            value,
            title: LANGUAGE_NAMES[value]
          }));
        case "refresh":
          return REFRESH_CHOICES.map((value) => ({
            value,
            title: t.refreshChoice(value)
          }));
        case "scope":
          return SCOPES.map((value) => ({
            value,
            title: value === "current" ? t.current : t.allSessions
          }));
        case "filter":
          return FILTERS.map((value) => ({
            value,
            title: t.statuses[value]
          }));
        case "sort":
          return SORTS.map((value) => ({
            value,
            title: t.sorts[value]
          }));
        case "time":
          return TIME_FORMATS.map((value) => ({
            value,
            title: t.timeFormats[value]
          }));
      }
    }
    const SETTING_KEYS = ["language", "refresh", "sort", "time", "scope", "filter"];
    const settingLabel = (key) => ({
      language: text().languageSetting,
      refresh: text().refreshSetting,
      scope: text().scopeSetting,
      filter: text().filterSetting,
      sort: text().sortSetting,
      time: text().timeSetting
    })[key];
    async function openSettings() {
      let last;
      for (;; ) {
        const current = settings();
        const key = await context.ui.dialog.select({
          title: text().settingsTitle,
          current: last,
          options: SETTING_KEYS.map((item) => ({
            value: item,
            title: settingLabel(item),
            footer: choices(item).find((choice) => choice.value === current[item])?.title
          }))
        });
        if (!key)
          break;
        last = key;
        const value = await context.ui.dialog.select({
          title: settingLabel(key),
          current: current[key],
          options: choices(key)
        });
        if (value !== undefined && value !== current[key])
          await update((draft) => {
            draft[key] = value;
          });
      }
      if (open() && windowBox && !windowBox.isDestroyed)
        windowBox.focus();
    }
    function Panel(props) {
      const sessionID = props.sessionID;
      const [rows, setRows] = createSignal2([]);
      const [loading, setLoading] = createSignal2(false);
      const [error, setError] = createSignal2();
      const [room, setRoom] = createSignal2();
      let active;
      let disposed = false;
      let serial = 0;
      let refreshing = false;
      let box;
      async function refresh(silent = false) {
        if (disposed)
          return;
        const version = ++serial;
        active?.abort();
        active = new AbortController;
        refreshing = true;
        setLoading(!silent);
        if (!silent)
          setError(undefined);
        try {
          const result = await api.list({
            signal: active.signal
          });
          if (disposed || version !== serial)
            return;
          setRows((previous) => retainUnchangedRows(previous, result));
          setError(undefined);
        } catch (cause) {
          if (!disposed && version === serial)
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (!disposed && version === serial) {
            refreshing = false;
            setLoading(false);
          }
        }
      }
      createEffect2(() => {
        const seconds = settings().refresh;
        if (!seconds)
          return;
        const interval = setInterval(() => {
          if (!refreshing)
            refresh(true);
        }, seconds * 1000);
        onCleanup2(() => clearInterval(interval));
      });
      const measure = () => {
        if (!box || box.isDestroyed)
          return;
        const next = composerRoom(box);
        if (next !== undefined && next !== room())
          queueMicrotask(() => {
            if (!disposed)
              setRoom(next);
          });
      };
      onMount2(() => {
        context.renderer.root.on("layout-changed", measure);
        measure();
        refresh();
      });
      onCleanup2(() => {
        disposed = true;
        serial++;
        active?.abort();
        context.renderer.root.off("layout-changed", measure);
        if (windowBox === box)
          windowBox = undefined;
      });
      return _$createComponent2(AutomationWindow, {
        rows,
        loading,
        error,
        currentSessionID: () => sessionID,
        theme,
        refresh,
        height: room,
        language,
        get initialScope() {
          return settings().scope;
        },
        get initialFilter() {
          return settings().filter;
        },
        openSettings,
        sort: () => settings().sort,
        timeFormat: () => settings().time,
        onRoot: (element) => {
          box = element;
          windowBox = element;
          setTimeout(() => {
            if (open() && windowBox === element && !element.isDestroyed)
              element.focus();
          }, 0);
        },
        pause: async (row) => {
          await api.pause(row.id);
          await refresh();
        },
        resume: async (row) => {
          const confirmed = await context.ui.dialog.confirm({
            title: text().resumeTitle,
            message: text().resumeMessage
          });
          if (confirmed && !disposed) {
            await api.resume(row.id);
            await refresh();
          }
        },
        remove: async (row) => {
          const confirmed = await context.ui.dialog.confirm({
            title: text().deleteTitle,
            message: text().deleteMessage(row.name || row.id, row.session?.title || row.sessionID || "\u2014"),
            label: {
              confirm: text().confirmDelete,
              cancel: text().cancel
            }
          });
          if (confirmed && !disposed) {
            await api.remove(row.id);
            await refresh();
          }
        },
        openSession: (row) => {
          const target = targetSessionID(row);
          if (target && target !== sessionID)
            context.ui.router.navigate({
              type: "session",
              sessionID: target
            });
        },
        close: hide,
        bindKeys: (target, actions) => {
          context.keymap.layer(() => ({
            target,
            priority: 20,
            commands: actions.map(({
              key,
              run
            }) => ({
              bind: key,
              run
            }))
          }));
          return () => {};
        }
      });
    }
    const disposeSlot = context.ui.slot({
      append: "session.composer.top",
      render: (input) => _$createComponent2(Show2, {
        get when() {
          return _$memo2(() => !!open())() && input.sessionID;
        },
        keyed: true,
        children: (sessionID) => _$createComponent2(Panel, {
          sessionID
        })
      })
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "scheduler.automation_status",
        title: text().commandTitle,
        group: "Automations",
        palette: true,
        slash: {
          name: "automation_status"
        },
        run() {
          context.ui.dialog.clear();
          show();
        }
      }, {
        id: "scheduler.automation_settings",
        title: text().settingsCommand,
        group: "Automations",
        palette: true,
        run() {
          context.ui.dialog.clear();
          openSettings();
        }
      }]
    }));
    return () => {
      disposeSlot();
    };
  }
});
export {
  tui_default as default,
  id
};
