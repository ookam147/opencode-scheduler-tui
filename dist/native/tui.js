// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = import.meta.require;

// src/native/tui.tsx
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createSignal as createSignal2, onCleanup as onCleanup2, onMount as onMount2, Show as Show2 } from "solid-js";

// src/native/client.ts
function toSession(info) {
  return {
    id: info.id,
    title: info.title,
    directory: info.location.directory,
    agent: info.agent,
    model: info.model ? { ...info.model } : undefined
  };
}
function toSchedule(info) {
  const { action, ...schedule } = info;
  return { ...schedule, prompt: action.prompt };
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
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function createNativeScheduleClient(client, language = "zh") {
  const api = client.experimental.schedule;
  return {
    async list(options) {
      const { signal } = options;
      signal?.throwIfAborted();
      const sessions = new Map;
      const warnings = [];
      if (options.scope === "current") {
        if (!options.sessionID)
          return { rows: [], warnings };
        sessions.set(options.sessionID, { id: options.sessionID });
        try {
          const info = await request(signal, () => client.session.get({ sessionID: options.sessionID }, { signal }));
          sessions.set(info.id, toSession(info));
        } catch (error) {
          signal?.throwIfAborted();
          warnings.push(language === "zh" ? `\u4F1A\u8BDD ${options.sessionID} \u5143\u6570\u636E\u8BFB\u53D6\u5931\u8D25\uFF1A${message(error)}` : `Could not read session metadata (${options.sessionID}): ${message(error)}`);
        }
      } else {
        let cursor;
        const seen = new Set;
        do {
          const page = await request(signal, () => client.session.list({ cursor, limit: 100 }, { signal }));
          for (const info of page.data) {
            sessions.set(info.id, toSession(info));
          }
          cursor = page.cursor.next ?? undefined;
          if (cursor && seen.has(cursor))
            throw new Error(language === "zh" ? "\u4F1A\u8BDD\u5206\u9875\u6E38\u6807\u91CD\u590D\uFF0C\u65E0\u6CD5\u5B8C\u6574\u5217\u51FA\u5168\u90E8\u8BA1\u5212" : "Repeated session cursor; cannot list all schedules completely");
          if (cursor)
            seen.add(cursor);
        } while (cursor);
      }
      const entries = [...sessions.values()];
      const results = new Array(entries.length);
      const failures = new Array(entries.length);
      let next = 0;
      async function worker() {
        while (next < entries.length) {
          signal?.throwIfAborted();
          const index = next++;
          const session = entries[index];
          try {
            const schedules = await request(signal, () => api.list({ sessionID: session.id }, { signal }));
            results[index] = schedules.map((info) => ({ ...toSchedule(info), sessionID: info.sessionID ?? session.id, session }));
          } catch (error) {
            signal?.throwIfAborted();
            failures[index] = `${session.title ?? (language === "zh" ? "\u672A\u547D\u540D\u4F1A\u8BDD" : "Untitled session")} (${session.id}): ${message(error)}${session.directory ? `
  ${session.directory}` : ""}`;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
      signal?.throwIfAborted();
      const rows = new Map;
      for (const group of results)
        for (const row of group ?? [])
          if (!rows.has(row.id))
            rows.set(row.id, row);
      for (const failure of failures)
        if (failure)
          warnings.push(failure);
      return { rows: [...rows.values()], warnings };
    },
    async pause(id) {
      return toSchedule(await api.pause({ scheduleID: id }));
    },
    async resume(id) {
      return toSchedule(await api.resume({ scheduleID: id }));
    },
    async remove(id) {
      await api.delete({ scheduleID: id });
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
function retainUnchangedWarnings(previous, next) {
  return previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next;
}

// src/native/i18n.ts
var CHINESE_TIME_ZONES = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Chungking",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Hong_Kong",
  "Asia/Macau",
  "Asia/Macao",
  "Asia/Taipei",
  "PRC",
  "ROC",
  "Hongkong"
]);
function detectLanguage(timeZone) {
  try {
    return CHINESE_TIME_ZONES.has(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) ? "zh" : "en";
  } catch {
    return "en";
  }
}
var zh = {
  title: "Schedules",
  current: "\u5F53\u524D\u4F1A\u8BDD",
  allSessions: "\u6240\u6709\u4F1A\u8BDD",
  status: "\u72B6\u6001",
  task: "\u4EFB\u52A1",
  plan: "\u8BA1\u5212",
  next: "\u4E0B\u6B21",
  timeZone: "\u65F6\u533A",
  ends: "\u622A\u6B62",
  runs: "\u5DF2\u8FD0\u884C",
  last: "\u4E0A\u6B21",
  prompt: "\u63D0\u793A\u8BCD",
  session: "\u6240\u5C5E\u4F1A\u8BDD",
  unknownSession: "\u672A\u77E5\u4F1A\u8BDD",
  execution: "\u6267\u884C\u65B9\u5F0F",
  executionNote: "\u89E6\u53D1\u65F6\u5411\u6240\u5C5E\u4F1A\u8BDD\u53D1\u9001\u63D0\u793A\u8BCD\uFF0C\u5E76\u76F4\u63A5\u6CBF\u7528\u8BE5\u4F1A\u8BDD\u7684\u5F53\u524D\u914D\u7F6E\uFF08\u672A\u7ED1\u5B9A\u72EC\u7ACB\u6A21\u578B\uFF09\u3002",
  scheduleID: "\u4EFB\u52A1 ID",
  sessionID: "\u4F1A\u8BDD ID",
  statuses: { all: "\u5168\u90E8", active: "\u8FD0\u884C\u4E2D", paused: "\u5DF2\u6682\u505C", done: "\u5DF2\u7ED3\u675F" },
  outcomes: { fired: "\u5DF2\u89E6\u53D1", late: "\u5EF6\u8FDF\u89E6\u53D1", skipped: "\u5DF2\u8DF3\u8FC7", disabled: "\u5DF2\u7981\u7528", failed: "\u5931\u8D25" },
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
  readIssues: "\u8BFB\u53D6\u95EE\u9898",
  back: "\u8FD4\u56DE",
  clearSearch: "\u6E05\u9664\u641C\u7D22",
  refreshing: "\u5237\u65B0\u4E2D\u2026",
  processing: "\u5904\u7406\u4E2D\u2026",
  searchPlaceholder: "\u641C\u7D22\u540D\u79F0\u3001\u63D0\u793A\u8BCD\u6216\u4F1A\u8BDD",
  selectTask: "\u9009\u62E9\u4E00\u4E2A\u4EFB\u52A1\u67E5\u770B\u8BE6\u60C5",
  reading: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u2026",
  readFailed: "\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25\uFF0C\u6309 r \u91CD\u8BD5",
  noCurrent: "\u5F53\u524D\u4E0D\u5728\u4F1A\u8BDD\u4E2D\uFF0C\u6309 s \u67E5\u770B\u6240\u6709\u4F1A\u8BDD",
  noMatches: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4EFB\u52A1",
  noSessionTasks: "\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1\u3002\u76F4\u63A5\u8BA9 agent \u5B89\u6392\u5373\u53EF\uFF0C\u4F8B\u5982\u300C\u6BCF\u4E2A\u5DE5\u4F5C\u65E5 9 \u70B9\u603B\u7ED3\u6628\u5929\u7684\u63D0\u4EA4\u300D",
  noTasks: "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u5B9A\u65F6\u4EFB\u52A1",
  pausedNext: "\u6682\u505C\u4E2D\uFF0C\u6062\u590D\u540E\u8BA1\u7B97",
  noMoreRuns: "\u4E0D\u518D\u89E6\u53D1",
  unlimited: "\u4E0D\u9650",
  neverFired: "\u5C1A\u672A\u89E6\u53D1",
  warningSummary: (count) => `\u26A0 ${count} \u4E2A\u4F1A\u8BDD\u7684\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25\uFF0C\u5217\u8868\u53EF\u80FD\u4E0D\u5B8C\u6574 \xB7 \u6309 w \u67E5\u770B`,
  warningTitle: (count) => `\u8BFB\u53D6\u95EE\u9898\uFF08${count}\uFF09`,
  warningHelp: "\u8FD9\u4E9B\u4F1A\u8BDD\u7684\u4EFB\u52A1\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5E38\u89C1\u539F\u56E0\u662F\u4F1A\u8BDD\u6240\u5728\u76EE\u5F55\u5DF2\u88AB\u5220\u9664\u6216\u672A\u5F00\u542F schedules\u3002\u5176\u4F59\u4F1A\u8BDD\u7684\u4EFB\u52A1\u4E0D\u53D7\u5F71\u54CD\u3002",
  runCount: (count, remaining) => `${count} \u6B21${remaining !== undefined ? ` \xB7 \u5269\u4F59 ${remaining} \u6B21` : ""}`,
  nextTime: (clock, relative) => `${clock}\uFF08${relative}\uFF09`,
  whenIn: (value) => `\u5EF6\u65F6 ${value}`,
  whenAt: (value) => `\u6307\u5B9A\u65F6\u95F4 ${value}`,
  whenEvery: (value) => `\u6BCF\u9694 ${value}`,
  today: "\u4ECA\u5929",
  tomorrow: "\u660E\u5929",
  yesterday: "\u6628\u5929",
  soon: "\u5373\u5C06",
  justNow: "\u521A\u521A",
  relative: (value, unit, future) => `${value} ${{ minute: "\u5206\u949F", hour: "\u5C0F\u65F6", day: "\u5929" }[unit]}${future ? "\u540E" : "\u524D"}`,
  sessionRequired: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u67E5\u770B\u5B9A\u65F6\u4EFB\u52A1\u3002",
  resumeTitle: "\u6062\u590D\u5B9A\u65F6\u4EFB\u52A1",
  resumeMessage: "\u8FC7\u671F\u7684\u4E00\u6B21\u6027\u4EFB\u52A1\u53EF\u80FD\u7ACB\u5373\u89E6\u53D1\uFF1B\u91CD\u590D\u4EFB\u52A1\u4ECE\u4E0B\u4E00\u4E2A\u65F6\u95F4\u69FD\u6062\u590D\u3002\u662F\u5426\u7EE7\u7EED\uFF1F",
  deleteTitle: "\u5220\u9664\u5B9A\u65F6\u4EFB\u52A1",
  deleteMessage: (name, session) => `\u786E\u5B9A\u5220\u9664\u300C${name}\u300D\u5417\uFF1F
\u6240\u5C5E\u4F1A\u8BDD\uFF1A${session}
\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002`,
  confirmDelete: "\u786E\u8BA4\u5220\u9664",
  cancel: "\u53D6\u6D88",
  commandTitle: "\u5B9A\u65F6\u4EFB\u52A1",
  commandDescription: "\u67E5\u770B\u548C\u7BA1\u7406\u4F1A\u8BDD\u5B9A\u65F6\u4EFB\u52A1"
};
var en = {
  title: "Schedules",
  current: "Current session",
  allSessions: "All sessions",
  status: "Status",
  task: "Task",
  plan: "Schedule",
  next: "Next",
  timeZone: "Time zone",
  ends: "Ends",
  runs: "Runs",
  last: "Last",
  prompt: "Prompt",
  session: "Session",
  unknownSession: "Unknown session",
  execution: "Execution",
  executionNote: "When triggered, the prompt is sent to the owning session using that session's current configuration (no separate model is bound).",
  scheduleID: "Schedule ID",
  sessionID: "Session ID",
  statuses: { all: "All", active: "Active", paused: "Paused", done: "Done" },
  outcomes: { fired: "Fired", late: "Fired late", skipped: "Skipped", disabled: "Disabled", failed: "Failed" },
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
  readIssues: "Read issues",
  back: "Back",
  clearSearch: "Clear search",
  refreshing: "Refreshing\u2026",
  processing: "Processing\u2026",
  searchPlaceholder: "Search names, prompts or sessions",
  selectTask: "Select a task to view details",
  reading: "Reading tasks\u2026",
  readFailed: "Could not read tasks; press r to retry",
  noCurrent: "No current session; press s to view all sessions",
  noMatches: "No matching tasks",
  noSessionTasks: "This session has no scheduled tasks. Ask the agent to schedule one, e.g. \u201CSummarize yesterday's commits at 9 on weekdays\u201D.",
  noTasks: "No scheduled tasks yet",
  pausedNext: "Paused; recalculated on resume",
  noMoreRuns: "Will not run again",
  unlimited: "Unlimited",
  neverFired: "Not yet fired",
  warningSummary: (count) => `\u26A0 Could not read tasks from ${count} session(s); list may be incomplete \xB7 Press w`,
  warningTitle: (count) => `Read issues (${count})`,
  warningHelp: "Tasks in these sessions could not be read. The session directory may have been deleted or schedules may be disabled. Other sessions are unaffected.",
  runCount: (count, remaining) => `${count} run(s)${remaining !== undefined ? ` \xB7 ${remaining} remaining` : ""}`,
  nextTime: (clock, relative) => `${clock} (${relative})`,
  whenIn: (value) => `In ${value}`,
  whenAt: (value) => `At ${value}`,
  whenEvery: (value) => `Every ${value}`,
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  soon: "Soon",
  justNow: "Just now",
  relative: (value, unit, future) => {
    const text = `${value} ${unit}${value === 1 ? "" : "s"}`;
    return future ? `in ${text}` : `${text} ago`;
  },
  sessionRequired: "Open a session first to view scheduled tasks.",
  resumeTitle: "Resume scheduled task",
  resumeMessage: "An overdue one-time task may fire immediately; repeating tasks resume at the next time slot. Continue?",
  deleteTitle: "Delete scheduled task",
  deleteMessage: (name, session) => `Delete \u201C${name}\u201D?
Session: ${session}
This cannot be undone.`,
  confirmDelete: "Delete",
  cancel: "Cancel",
  commandTitle: "Show or hide scheduled tasks",
  commandDescription: "View and manage session scheduled tasks"
};
function words(language = detectLanguage()) {
  return language === "zh" ? zh : en;
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
function nextLabel(row, now = Date.now(), language = "zh") {
  if (row.status === "done")
    return words(language).statuses.done;
  if (row.status === "paused")
    return words(language).statuses.paused;
  return row.nextDueAt === undefined ? "\u2014" : relativeTime(row.nextDueAt, now, language);
}

// src/native/model.ts
function describeWhen(when) {
  switch (when.type) {
    case "in":
      return `\u5EF6\u65F6 ${when.in}`;
    case "at":
      return `\u6307\u5B9A\u65F6\u95F4 ${when.at}`;
    case "every":
      return `\u6BCF\u9694 ${when.every}`;
    case "cron":
      return `Cron ${when.cron}`;
  }
}
function selectSchedules(rows, options = {}) {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return rows.filter((row) => {
    if (options.status && options.status !== "all" && row.status !== options.status)
      return false;
    if (options.sessionID && row.sessionID !== options.sessionID)
      return false;
    return !query || [
      row.id,
      row.name,
      row.prompt,
      row.sessionID,
      row.session?.title,
      row.session?.directory,
      row.session?.agent,
      row.session?.model?.id,
      row.session?.model?.providerID,
      row.session?.model?.variant,
      describeWhen(row.when),
      row.tz
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}
function countSchedules(rows) {
  return rows.reduce((counts, row) => {
    counts.all++;
    counts[row.status]++;
    return counts;
  }, { all: 0, active: 0, paused: 0, done: 0 });
}

// src/native/window.tsx
var FILTERS = ["all", "active", "paused", "done"];
var SCOPES = ["current", "all"];
var RAIL_WIDTH = 16;
var WIDE2 = 110;
var NEXT_WIDTH = 10;
var WHEN_WIDTH = 20;
var LABEL_WIDTH = 8;
var HINT_GAP = "  ";
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
function ScheduleWindow(props) {
  const language = () => props.language ?? detectLanguage();
  const text = () => words(language());
  const describeWhen2 = (when) => {
    switch (when.type) {
      case "in":
        return text().whenIn(when.in);
      case "at":
        return text().whenAt(when.at);
      case "every":
        return text().whenEvery(when.every);
      case "cron":
        return `Cron ${when.cron}`;
    }
  };
  const terminal = useTerminalDimensions();
  const [width, setWidth] = createSignal(Math.max(20, terminal().width - 4));
  const [filter, setFilter] = createSignal("all");
  const [scope, setScope] = createSignal(props.currentSessionID() ? "current" : "all");
  createEffect(() => props.scopeChanged?.(scope()));
  const [query, setQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [selectedID, setSelectedID] = createSignal();
  const [pending, setPending] = createSignal(false);
  const [actionError, setActionError] = createSignal();
  const [showWarnings, setShowWarnings] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const [hasKeyboard, setHasKeyboard] = createSignal(false);
  let root;
  let list;
  let detail;
  let previousIndex = 0;
  let alive = true;
  const theme = props.theme;
  const faint = () => theme().faint ?? theme().muted;
  const warnings = () => props.warnings?.() ?? [];
  const wide = () => width() >= WIDE2;
  const detailWidth = () => wide() ? Math.min(60, Math.max(40, Math.floor(width() * 0.4))) : width();
  const listWidth = () => wide() ? width() - RAIL_WIDTH - 1 - detailWidth() : width();
  const rowWidth = () => listWidth() - 2;
  const whenWidth = () => rowWidth() >= 56 ? WHEN_WIDTH : 0;
  const nameWidth = () => Math.max(6, rowWidth() - 2 - NEXT_WIDTH - 2 - (whenWidth() ? whenWidth() + 2 : 0));
  const scoped = createMemo(() => scope() === "all" ? props.rows() : props.rows().filter((row) => !!props.currentSessionID() && row.sessionID === props.currentSessionID()));
  const counts = createMemo(() => countSchedules(scoped()));
  const visible = createMemo(() => selectSchedules(scoped(), {
    status: filter(),
    query: query()
  }));
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
          list?.scrollChildIntoView(`schedule-row-${id}`);
      });
  });
  createEffect(() => {
    if (!warnings().length)
      setShowWarnings(false);
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
    if (showWarnings())
      setShowWarnings(false);
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
    setShowWarnings(false);
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
    if (row?.sessionID)
      invoke(() => props.openSession(row));
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
    key: "w",
    run: () => {
      if (warnings().length)
        setShowWarnings(!showWarnings());
    }
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
    const action = actions.find((action2) => action2.key === name || action2.key === "/" && key.sequence === "/");
    if (action) {
      key.preventDefault();
      key.stopPropagation();
      action.run();
    }
  }
  const statusColor = (status) => status === "active" ? theme().success : status === "paused" ? theme().warning : theme().muted;
  const pickFilter = (value) => {
    setFilter(value);
    root?.focus();
  };
  const title = (row) => row.name || row.prompt.replace(/\s+/g, " ").trim() || row.id;
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
        key: "/schedule_status",
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
    }] : [], ...row?.sessionID ? [{
      key: "o",
      label: text().openSession
    }] : [], ...warnings().length ? [{
      key: "w",
      label: text().readIssues
    }] : [], {
      key: "esc",
      label: showWarnings() ? text().back : query() ? text().clearSearch : text().close
    }];
  };
  const notice = () => {
    const failure = actionError() || props.error();
    if (failure)
      return {
        text: `\u2715 ${failure}`,
        color: theme().error
      };
    const count = warnings().length;
    if (count)
      return {
        text: text().warningSummary(count),
        color: theme().warning
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
    _$insert(_el$11, () => `  ${fit(text().task, nameWidth())}  ${whenWidth() ? `${fit(text().plan, whenWidth())}  ` : ""}${fit(text().next, NEXT_WIDTH, "right")}`);
    var _ref$ = list;
    typeof _ref$ === "function" ? _$use(_ref$, _el$12) : list = _el$12;
    _$setProp(_el$12, "id", "schedule-list");
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
            return (() => {
              var _el$14 = _$createElement("box"), _el$15 = _$createElement("text"), _el$16 = _$createElement("span"), _el$17 = _$createElement("span"), _el$18 = _$createElement("span");
              _$insertNode(_el$14, _el$15);
              _$setProp(_el$14, "height", 1);
              _$setProp(_el$14, "flexShrink", 0);
              _$setProp(_el$14, "onMouseUp", () => {
                setSelectedID(row.id);
                setShowWarnings(false);
                root?.focus();
              });
              _$insertNode(_el$15, _el$16);
              _$insertNode(_el$15, _el$17);
              _$insertNode(_el$15, _el$18);
              _$setProp(_el$15, "wrapMode", "none");
              _$setProp(_el$15, "selectable", false);
              _$insert(_el$16, () => `${STATUS_GLYPHS[row.status]} `);
              _$insert(_el$15, (() => {
                var _c$2 = _$memo(() => !!chosen());
                return () => _c$2() ? (() => {
                  var _el$19 = _$createElement("b");
                  _$insert(_el$19, () => fit(title(row), nameWidth()));
                  _$effect((_$p) => _$setProp(_el$19, "style", {
                    fg: theme().accent
                  }, _$p));
                  return _el$19;
                })() : (() => {
                  var _el$20 = _$createElement("span");
                  _$insert(_el$20, () => fit(title(row), nameWidth()));
                  _$effect((_$p) => _$setProp(_el$20, "style", {
                    fg: row.status === "done" ? theme().muted : theme().text
                  }, _$p));
                  return _el$20;
                })();
              })(), _el$17);
              _$insert(_el$17, (() => {
                var _c$3 = _$memo(() => !!whenWidth());
                return () => _c$3() ? `  ${fit(describeWhen2(row.when), whenWidth())}` : "";
              })());
              _$insert(_el$18, () => `  ${fit(nextLabel(row, now(), language()), NEXT_WIDTH, "right")}`);
              _$effect((_p$) => {
                var _v$15 = `schedule-row-${row.id}`, _v$16 = chosen() ? theme().raised : undefined, _v$17 = {
                  fg: statusColor(row.status)
                }, _v$18 = {
                  fg: theme().muted
                }, _v$19 = {
                  fg: row.status === "active" ? theme().text : faint()
                };
                _v$15 !== _p$.e && (_p$.e = _$setProp(_el$14, "id", _v$15, _p$.e));
                _v$16 !== _p$.t && (_p$.t = _$setProp(_el$14, "backgroundColor", _v$16, _p$.t));
                _v$17 !== _p$.a && (_p$.a = _$setProp(_el$16, "style", _v$17, _p$.a));
                _v$18 !== _p$.o && (_p$.o = _$setProp(_el$17, "style", _v$18, _p$.o));
                _v$19 !== _p$.i && (_p$.i = _$setProp(_el$18, "style", _v$19, _p$.i));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined,
                i: undefined
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
  const Detail = (detailProps) => {
    const row = () => detailProps.row;
    return (() => {
      var _el$21 = _$createElement("box"), _el$22 = _$createElement("text"), _el$23 = _$createElement("b"), _el$24 = _$createElement("text"), _el$25 = _$createElement("span"), _el$26 = _$createElement("span"), _el$27 = _$createElement("box"), _el$28 = _$createElement("box"), _el$29 = _$createElement("text"), _el$30 = _$createElement("box"), _el$31 = _$createElement("text"), _el$32 = _$createElement("box"), _el$33 = _$createElement("text"), _el$34 = _$createElement("text"), _el$36 = _$createElement("box"), _el$37 = _$createElement("text"), _el$38 = _$createElement("text"), _el$39 = _$createElement("box"), _el$40 = _$createElement("box"), _el$41 = _$createElement("box"), _el$42 = _$createElement("text"), _el$43 = _$createElement("text");
      _$insertNode(_el$21, _el$22);
      _$insertNode(_el$21, _el$24);
      _$insertNode(_el$21, _el$27);
      _$insertNode(_el$21, _el$28);
      _$insertNode(_el$21, _el$29);
      _$insertNode(_el$21, _el$30);
      _$insertNode(_el$21, _el$32);
      _$insertNode(_el$21, _el$33);
      _$insertNode(_el$21, _el$34);
      _$insertNode(_el$21, _el$36);
      _$insertNode(_el$21, _el$37);
      _$insertNode(_el$21, _el$38);
      _$insertNode(_el$21, _el$39);
      _$insertNode(_el$21, _el$40);
      _$insertNode(_el$21, _el$41);
      _$insertNode(_el$21, _el$42);
      _$insertNode(_el$21, _el$43);
      _$setProp(_el$21, "flexDirection", "column");
      _$setProp(_el$21, "flexShrink", 0);
      _$insertNode(_el$22, _el$23);
      _$setProp(_el$22, "wrapMode", "word");
      _$setProp(_el$22, "flexShrink", 0);
      _$insert(_el$23, () => title(row()));
      _$insertNode(_el$24, _el$25);
      _$insertNode(_el$24, _el$26);
      _$setProp(_el$24, "wrapMode", "none");
      _$setProp(_el$24, "flexShrink", 0);
      _$insert(_el$25, () => `${STATUS_GLYPHS[row().status]} ${text().statuses[row().status]}`);
      _$insert(_el$26, () => `  \xB7  ${describeWhen2(row().when)}`);
      _$setProp(_el$27, "height", 1);
      _$setProp(_el$27, "flexShrink", 0);
      _$insert(_el$21, _$createComponent(Field, {
        get label() {
          return text().next;
        },
        get children() {
          return _$memo(() => !!(row().status === "active" && row().nextDueAt !== undefined))() ? text().nextTime(clockTime(row().nextDueAt, now(), language()), relativeTime(row().nextDueAt, now(), language())) : _$memo(() => row().status === "paused")() ? text().pausedNext : _$memo(() => row().status === "done")() ? text().noMoreRuns : "\u2014";
        }
      }), _el$28);
      _$insert(_el$21, _$createComponent(Field, {
        get label() {
          return text().timeZone;
        },
        get children() {
          return row().tz;
        }
      }), _el$28);
      _$insert(_el$21, _$createComponent(Field, {
        get label() {
          return text().ends;
        },
        get children() {
          return _$memo(() => row().endsAt !== undefined)() ? clockTime(row().endsAt, now(), language()) : text().unlimited;
        }
      }), _el$28);
      _$insert(_el$21, _$createComponent(Field, {
        get label() {
          return text().runs;
        },
        get children() {
          return text().runCount(row().runCount, row().remainingRuns);
        }
      }), _el$28);
      _$insert(_el$21, _$createComponent(Field, {
        get label() {
          return text().last;
        },
        get color() {
          return _$memo(() => row().lastOutcome === "failed")() ? theme().error : undefined;
        },
        get children() {
          return _$memo(() => row().lastFiredAt !== undefined)() ? `${clockTime(row().lastFiredAt, now(), language())}${row().lastOutcome ? ` \xB7 ${text().outcomes[row().lastOutcome]}` : ""}` : text().neverFired;
        }
      }), _el$28);
      _$setProp(_el$28, "height", 1);
      _$setProp(_el$28, "flexShrink", 0);
      _$setProp(_el$29, "flexShrink", 0);
      _$insert(_el$29, () => text().prompt);
      _$insertNode(_el$30, _el$31);
      _$setProp(_el$30, "flexShrink", 0);
      _$setProp(_el$30, "border", ["left"]);
      _$setProp(_el$30, "paddingLeft", 1);
      _$setProp(_el$30, "marginTop", 0);
      _$setProp(_el$31, "wrapMode", "word");
      _$insert(_el$31, () => row().prompt || "\u2014");
      _$setProp(_el$32, "height", 1);
      _$setProp(_el$32, "flexShrink", 0);
      _$setProp(_el$33, "flexShrink", 0);
      _$insert(_el$33, () => text().session);
      _$setProp(_el$34, "wrapMode", "word");
      _$setProp(_el$34, "flexShrink", 0);
      _$insert(_el$34, () => row().session?.title || row().sessionID || text().unknownSession);
      _$insert(_el$21, _$createComponent(Show, {
        get when() {
          return row().session?.directory;
        },
        get children() {
          var _el$35 = _$createElement("text");
          _$setProp(_el$35, "wrapMode", "word");
          _$setProp(_el$35, "flexShrink", 0);
          _$insert(_el$35, () => row().session?.directory);
          _$effect((_$p) => _$setProp(_el$35, "fg", faint(), _$p));
          return _el$35;
        }
      }), _el$36);
      _$setProp(_el$36, "height", 1);
      _$setProp(_el$36, "flexShrink", 0);
      _$setProp(_el$37, "flexShrink", 0);
      _$insert(_el$37, () => text().execution);
      _$setProp(_el$38, "wrapMode", "word");
      _$setProp(_el$38, "flexShrink", 0);
      _$insert(_el$38, () => text().executionNote);
      _$setProp(_el$39, "height", 1);
      _$setProp(_el$39, "flexShrink", 0);
      _$setProp(_el$40, "flexDirection", "row");
      _$setProp(_el$40, "gap", 1);
      _$setProp(_el$40, "flexShrink", 0);
      _$setProp(_el$40, "flexWrap", "wrap");
      _$insert(_el$40, _$createComponent(Show, {
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
      _$insert(_el$40, _$createComponent(Button, {
        hotkey: "d",
        get label() {
          return text().remove;
        },
        get color() {
          return theme().error;
        },
        run: remove
      }), null);
      _$insert(_el$40, _$createComponent(Show, {
        get when() {
          return row().sessionID;
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
      _$setProp(_el$41, "height", 1);
      _$setProp(_el$41, "flexShrink", 0);
      _$setProp(_el$42, "wrapMode", "word");
      _$setProp(_el$42, "flexShrink", 0);
      _$insert(_el$42, () => `${text().scheduleID}: ${row().id}`);
      _$setProp(_el$43, "wrapMode", "word");
      _$setProp(_el$43, "flexShrink", 0);
      _$insert(_el$43, () => `${text().sessionID}: ${row().sessionID || "\u2014"}`);
      _$effect((_p$) => {
        var _v$20 = theme().text, _v$21 = {
          fg: statusColor(row().status)
        }, _v$22 = {
          fg: faint()
        }, _v$23 = theme().muted, _v$24 = theme().accent, _v$25 = theme().text, _v$26 = theme().muted, _v$27 = theme().text, _v$28 = theme().muted, _v$29 = theme().text, _v$30 = faint(), _v$31 = faint();
        _v$20 !== _p$.e && (_p$.e = _$setProp(_el$22, "fg", _v$20, _p$.e));
        _v$21 !== _p$.t && (_p$.t = _$setProp(_el$25, "style", _v$21, _p$.t));
        _v$22 !== _p$.a && (_p$.a = _$setProp(_el$26, "style", _v$22, _p$.a));
        _v$23 !== _p$.o && (_p$.o = _$setProp(_el$29, "fg", _v$23, _p$.o));
        _v$24 !== _p$.i && (_p$.i = _$setProp(_el$30, "borderColor", _v$24, _p$.i));
        _v$25 !== _p$.n && (_p$.n = _$setProp(_el$31, "fg", _v$25, _p$.n));
        _v$26 !== _p$.s && (_p$.s = _$setProp(_el$33, "fg", _v$26, _p$.s));
        _v$27 !== _p$.h && (_p$.h = _$setProp(_el$34, "fg", _v$27, _p$.h));
        _v$28 !== _p$.r && (_p$.r = _$setProp(_el$37, "fg", _v$28, _p$.r));
        _v$29 !== _p$.d && (_p$.d = _$setProp(_el$38, "fg", _v$29, _p$.d));
        _v$30 !== _p$.l && (_p$.l = _$setProp(_el$42, "fg", _v$30, _p$.l));
        _v$31 !== _p$.u && (_p$.u = _$setProp(_el$43, "fg", _v$31, _p$.u));
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
      return _el$21;
    })();
  };
  const Warnings = () => (() => {
    var _el$44 = _$createElement("box"), _el$45 = _$createElement("text"), _el$46 = _$createElement("b"), _el$47 = _$createElement("text"), _el$48 = _$createElement("box");
    _$insertNode(_el$44, _el$45);
    _$insertNode(_el$44, _el$47);
    _$insertNode(_el$44, _el$48);
    _$setProp(_el$44, "flexDirection", "column");
    _$setProp(_el$44, "flexShrink", 0);
    _$insertNode(_el$45, _el$46);
    _$setProp(_el$45, "flexShrink", 0);
    _$insert(_el$46, () => text().warningTitle(warnings().length));
    _$setProp(_el$47, "wrapMode", "word");
    _$setProp(_el$47, "flexShrink", 0);
    _$insert(_el$47, () => text().warningHelp);
    _$setProp(_el$48, "height", 1);
    _$setProp(_el$48, "flexShrink", 0);
    _$insert(_el$44, _$createComponent(For, {
      get each() {
        return warnings();
      },
      children: (warning) => (() => {
        var _el$49 = _$createElement("text");
        _$setProp(_el$49, "wrapMode", "word");
        _$setProp(_el$49, "flexShrink", 0);
        _$insert(_el$49, `\u2022 ${warning}`);
        _$effect((_$p) => _$setProp(_el$49, "fg", theme().text, _$p));
        return _el$49;
      })()
    }), null);
    _$effect((_p$) => {
      var _v$32 = theme().warning, _v$33 = theme().muted;
      _v$32 !== _p$.e && (_p$.e = _$setProp(_el$45, "fg", _v$32, _p$.e));
      _v$33 !== _p$.t && (_p$.t = _$setProp(_el$47, "fg", _v$33, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$44;
  })();
  return (() => {
    var _el$50 = _$createElement("box"), _el$51 = _$createElement("box"), _el$52 = _$createElement("text"), _el$53 = _$createElement("b"), _el$54 = _$createElement("box"), _el$56 = _$createElement("text"), _el$63 = _$createElement("box"), _el$64 = _$createElement("scrollbox"), _el$65 = _$createElement("box");
    _$insertNode(_el$50, _el$51);
    _$insertNode(_el$50, _el$63);
    _$insertNode(_el$50, _el$65);
    _$use((box) => {
      root = box;
      box.on("focused", () => setHasKeyboard(true));
      box.on("blurred", () => setHasKeyboard(false));
      props.onRoot?.(box);
    }, _el$50);
    _$setProp(_el$50, "id", "native-schedule-window");
    _$setProp(_el$50, "focusable", true);
    _$setProp(_el$50, "flexDirection", "column");
    _$setProp(_el$50, "flexShrink", 0);
    _$setProp(_el$50, "width", "100%");
    _$setProp(_el$50, "overflow", "hidden");
    _$setProp(_el$50, "border", true);
    _$setProp(_el$50, "borderStyle", "rounded");
    _$setProp(_el$50, "paddingLeft", 1);
    _$setProp(_el$50, "paddingRight", 1);
    _$setProp(_el$50, "onKeyDown", onKey);
    _$setProp(_el$50, "onSizeChange", function() {
      const measured = this.width - 4;
      if (measured > 0 && measured !== width())
        queueMicrotask(() => {
          if (alive)
            setWidth(measured);
        });
    });
    _$setProp(_el$50, "onMouseDown", () => {
      if (!searching())
        root?.focus();
    });
    _$insertNode(_el$51, _el$52);
    _$insertNode(_el$51, _el$54);
    _$insertNode(_el$51, _el$56);
    _$setProp(_el$51, "flexDirection", "row");
    _$setProp(_el$51, "flexShrink", 0);
    _$setProp(_el$51, "height", 1);
    _$setProp(_el$51, "gap", 1);
    _$insertNode(_el$52, _el$53);
    _$setProp(_el$52, "wrapMode", "none");
    _$setProp(_el$52, "flexShrink", 0);
    _$setProp(_el$52, "marginRight", 1);
    _$insert(_el$53, () => text().title);
    _$insert(_el$51, _$createComponent(For, {
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
    }), _el$54);
    _$setProp(_el$54, "flexGrow", 1);
    _$insert(_el$51, _$createComponent(Show, {
      get when() {
        return busy();
      },
      get children() {
        var _el$55 = _$createElement("text");
        _$setProp(_el$55, "flexShrink", 0);
        _$insert(_el$55, (() => {
          var _c$4 = _$memo(() => !!props.loading());
          return () => _c$4() ? text().refreshing : text().processing;
        })());
        _$effect((_$p) => _$setProp(_el$55, "fg", theme().muted, _$p));
        return _el$55;
      }
    }), _el$56);
    _$insertNode(_el$56, _$createTextNode(`esc`));
    _$setProp(_el$56, "flexShrink", 0);
    _$setProp(_el$56, "selectable", false);
    _$setProp(_el$56, "onMouseUp", close);
    _$insert(_el$50, _$createComponent(Show, {
      get when() {
        return !wide();
      },
      get children() {
        var _el$58 = _$createElement("box");
        _$setProp(_el$58, "flexDirection", "row");
        _$setProp(_el$58, "flexShrink", 0);
        _$setProp(_el$58, "height", 1);
        _$insert(_el$58, _$createComponent(For, {
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
        return _el$58;
      }
    }), _el$63);
    _$insert(_el$50, _$createComponent(Show, {
      get when() {
        return searching() || query();
      },
      get children() {
        var _el$59 = _$createElement("box"), _el$60 = _$createElement("text");
        _$insertNode(_el$59, _el$60);
        _$setProp(_el$59, "id", "schedule-search-box");
        _$setProp(_el$59, "flexDirection", "row");
        _$setProp(_el$59, "height", 1);
        _$setProp(_el$59, "flexShrink", 0);
        _$setProp(_el$59, "marginTop", 1);
        _$setProp(_el$59, "onMouseUp", () => setSearching(true));
        _$insertNode(_el$60, _$createTextNode(`/ `));
        _$setProp(_el$60, "flexShrink", 0);
        _$insert(_el$59, _$createComponent(Show, {
          get when() {
            return searching();
          },
          get fallback() {
            return (() => {
              var _el$66 = _$createElement("text");
              _$setProp(_el$66, "wrapMode", "none");
              _$insert(_el$66, query);
              _$effect((_$p) => _$setProp(_el$66, "fg", theme().text, _$p));
              return _el$66;
            })();
          },
          get children() {
            var _el$62 = _$createElement("input");
            _$setProp(_el$62, "id", "schedule-search");
            _$setProp(_el$62, "flexGrow", 1);
            _$setProp(_el$62, "onInput", setQuery);
            _$setProp(_el$62, "onKeyDown", (key) => {
              if (["escape", "return", "enter", "tab"].includes(key.name)) {
                key.preventDefault();
                key.stopPropagation();
                exitSearch();
              }
            });
            _$effect((_p$) => {
              var _v$34 = query(), _v$35 = searching(), _v$36 = text().searchPlaceholder, _v$37 = theme().text, _v$38 = theme().raised;
              _v$34 !== _p$.e && (_p$.e = _$setProp(_el$62, "value", _v$34, _p$.e));
              _v$35 !== _p$.t && (_p$.t = _$setProp(_el$62, "focused", _v$35, _p$.t));
              _v$36 !== _p$.a && (_p$.a = _$setProp(_el$62, "placeholder", _v$36, _p$.a));
              _v$37 !== _p$.o && (_p$.o = _$setProp(_el$62, "textColor", _v$37, _p$.o));
              _v$38 !== _p$.i && (_p$.i = _$setProp(_el$62, "backgroundColor", _v$38, _p$.i));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined,
              i: undefined
            });
            return _el$62;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$60, "fg", theme().accent, _$p));
        return _el$59;
      }
    }), _el$63);
    _$insert(_el$50, _$createComponent(Show, {
      get when() {
        return notice();
      },
      children: (item) => (() => {
        var _el$67 = _$createElement("text");
        _$setProp(_el$67, "flexShrink", 0);
        _$setProp(_el$67, "height", 1);
        _$setProp(_el$67, "marginTop", 1);
        _$setProp(_el$67, "wrapMode", "none");
        _$setProp(_el$67, "selectable", false);
        _$setProp(_el$67, "onMouseUp", () => {
          if (warnings().length)
            setShowWarnings(!showWarnings());
        });
        _$insert(_el$67, () => fit(item().text, width()));
        _$effect((_$p) => _$setProp(_el$67, "fg", item().color, _$p));
        return _el$67;
      })()
    }), _el$63);
    _$insertNode(_el$63, _el$64);
    _$setProp(_el$63, "flexGrow", 1);
    _$setProp(_el$63, "flexBasis", 0);
    _$setProp(_el$63, "minHeight", 0);
    _$setProp(_el$63, "marginTop", 1);
    _$setProp(_el$63, "overflow", "hidden");
    _$insert(_el$63, _$createComponent(Show, {
      get when() {
        return wide();
      },
      get children() {
        return _$createComponent(Rail, {});
      }
    }), _el$64);
    _$insert(_el$63, _$createComponent(List, {}), _el$64);
    var _ref$2 = detail;
    typeof _ref$2 === "function" ? _$use(_ref$2, _el$64) : detail = _el$64;
    _$setProp(_el$64, "id", "schedule-detail");
    _$setProp(_el$64, "flexGrow", 1);
    _$setProp(_el$64, "flexBasis", 0);
    _$setProp(_el$64, "minWidth", 0);
    _$setProp(_el$64, "minHeight", 0);
    _$setProp(_el$64, "scrollX", false);
    _$setProp(_el$64, "paddingRight", 1);
    _$insert(_el$64, _$createComponent(Show, {
      get when() {
        return !showWarnings();
      },
      get fallback() {
        return _$createComponent(Warnings, {});
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return selected();
          },
          get fallback() {
            return (() => {
              var _el$68 = _$createElement("text");
              _$setProp(_el$68, "wrapMode", "word");
              _$insert(_el$68, (() => {
                var _c$5 = _$memo(() => !!visible().length);
                return () => _c$5() ? text().selectTask : "";
              })());
              _$effect((_$p) => _$setProp(_el$68, "fg", faint(), _$p));
              return _el$68;
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
    _$setProp(_el$65, "id", "schedule-footer");
    _$setProp(_el$65, "flexDirection", "column");
    _$setProp(_el$65, "flexShrink", 0);
    _$setProp(_el$65, "marginTop", 1);
    _$insert(_el$65, _$createComponent(For, {
      get each() {
        return keyHintLines(hints(), width());
      },
      children: (line) => (() => {
        var _el$69 = _$createElement("text");
        _$setProp(_el$69, "wrapMode", "none");
        _$setProp(_el$69, "selectable", false);
        _$insert(_el$69, () => line.flatMap((hint, index) => [...index ? [(() => {
          var _el$70 = _$createElement("span");
          _$insertNode(_el$70, _$createTextNode(`  `));
          _$effect((_$p) => _$setProp(_el$70, "style", {
            fg: theme().muted
          }, _$p));
          return _el$70;
        })()] : [], (() => {
          var _el$72 = _$createElement("b");
          _$insert(_el$72, () => hint.key);
          _$effect((_$p) => _$setProp(_el$72, "style", {
            fg: theme().text
          }, _$p));
          return _el$72;
        })(), (() => {
          var _el$73 = _$createElement("span");
          _$insert(_el$73, () => ` ${hint.label}`);
          _$effect((_$p) => _$setProp(_el$73, "style", {
            fg: theme().muted
          }, _$p));
          return _el$73;
        })()]));
        return _el$69;
      })()
    }));
    _$effect((_p$) => {
      var _v$39 = props.height ? props.height() ?? 20 : "100%", _v$40 = hasKeyboard() ? theme().accent : theme().border, _v$41 = theme().text, _v$42 = theme().muted, _v$43 = wide() ? "row" : "column", _v$44 = wide() ? ["left"] : ["top"], _v$45 = theme().border, _v$46 = wide() ? 2 : 0;
      _v$39 !== _p$.e && (_p$.e = _$setProp(_el$50, "height", _v$39, _p$.e));
      _v$40 !== _p$.t && (_p$.t = _$setProp(_el$50, "borderColor", _v$40, _p$.t));
      _v$41 !== _p$.a && (_p$.a = _$setProp(_el$52, "fg", _v$41, _p$.a));
      _v$42 !== _p$.o && (_p$.o = _$setProp(_el$56, "fg", _v$42, _p$.o));
      _v$43 !== _p$.i && (_p$.i = _$setProp(_el$63, "flexDirection", _v$43, _p$.i));
      _v$44 !== _p$.n && (_p$.n = _$setProp(_el$64, "border", _v$44, _p$.n));
      _v$45 !== _p$.s && (_p$.s = _$setProp(_el$64, "borderColor", _v$45, _p$.s));
      _v$46 !== _p$.h && (_p$.h = _$setProp(_el$64, "paddingLeft", _v$46, _p$.h));
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
    return _el$50;
  })();
}

// src/native/tui.tsx
var id = "opencode-scheduler";
var tui_default = Plugin.define({
  id,
  setup(context) {
    const language = detectLanguage();
    const text = words(language);
    const api = createNativeScheduleClient(context.client, language);
    const [open, setOpen] = createSignal2(false);
    let windowBox;
    let focusBefore = null;
    function show() {
      const current = context.ui.router.current();
      if (current.type !== "session") {
        context.ui.toast.show({
          variant: "info",
          title: "Schedules",
          message: text.sessionRequired
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
      error: context.theme.text.feedback.error.base
    });
    function Panel(props) {
      const sessionID = props.sessionID;
      const [rows, setRows] = createSignal2([]);
      const [loading, setLoading] = createSignal2(false);
      const [error, setError] = createSignal2();
      const [warnings, setWarnings] = createSignal2([]);
      const [room, setRoom] = createSignal2();
      let scope = "current";
      let active;
      let disposed = false;
      let serial = 0;
      let lastGlobalRefresh = 0;
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
            scope,
            sessionID,
            signal: active.signal
          });
          if (disposed || version !== serial)
            return;
          setRows((previous) => retainUnchangedRows(previous, result.rows));
          setWarnings((previous) => retainUnchangedWarnings(previous, result.warnings));
          setError(undefined);
          if (scope === "all")
            lastGlobalRefresh = Date.now();
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
      const interval = setInterval(() => {
        if (!refreshing && (scope === "current" || Date.now() - lastGlobalRefresh >= 60000))
          refresh(true);
      }, 5000);
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
      });
      onCleanup2(() => {
        disposed = true;
        serial++;
        active?.abort();
        clearInterval(interval);
        context.renderer.root.off("layout-changed", measure);
        if (windowBox === box)
          windowBox = undefined;
      });
      return _$createComponent2(ScheduleWindow, {
        rows,
        loading,
        error,
        warnings,
        currentSessionID: () => sessionID,
        theme,
        refresh,
        height: room,
        language,
        onRoot: (element) => {
          box = element;
          windowBox = element;
          setTimeout(() => {
            if (open() && windowBox === element && !element.isDestroyed)
              element.focus();
          }, 0);
        },
        scopeChanged: (next) => {
          scope = next;
          setRows([]);
          refresh();
        },
        pause: async (row) => {
          await api.pause(row.id);
          await refresh();
        },
        resume: async (row) => {
          const confirmed = await context.ui.dialog.confirm({
            title: text.resumeTitle,
            message: text.resumeMessage
          });
          if (confirmed && !disposed) {
            await api.resume(row.id);
            await refresh();
          }
        },
        remove: async (row) => {
          const confirmed = await context.ui.dialog.confirm({
            title: text.deleteTitle,
            message: text.deleteMessage(row.name || row.id, row.session?.title || row.sessionID || "\u2014"),
            label: {
              confirm: text.confirmDelete,
              cancel: text.cancel
            }
          });
          if (confirmed && !disposed) {
            await api.remove(row.id);
            await refresh();
          }
        },
        openSession: (row) => {
          if (row.sessionID && row.sessionID !== sessionID)
            context.ui.router.navigate({
              type: "session",
              sessionID: row.sessionID
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
        id: "scheduler.open",
        title: text.commandTitle,
        group: "Schedules",
        palette: true,
        slash: {
          name: "schedule_status"
        },
        run() {
          context.ui.dialog.clear();
          show();
        }
      }]
    }));
    return () => {
      disposeSlot();
    };
  }
});
export {
  id,
  tui_default as default
};
