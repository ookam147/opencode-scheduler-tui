export type Language = "zh" | "en"

const CHINESE_TIME_ZONES = new Set([
  "Asia/Shanghai", "Asia/Chongqing", "Asia/Chungking", "Asia/Harbin", "Asia/Urumqi",
  "Asia/Hong_Kong", "Asia/Macau", "Asia/Macao", "Asia/Taipei", "PRC", "ROC", "Hongkong",
])

/** UI language comes from the host machine, never a schedule's time zone. */
export function detectLanguage(timeZone?: string): Language {
  try { return CHINESE_TIME_ZONES.has(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) ? "zh" : "en" }
  catch { return "en" }
}

const zh = {
  title: "Schedules", current: "当前会话", allSessions: "所有会话",
  status: "状态", task: "任务", plan: "计划", next: "下次", timeZone: "时区", ends: "截止",
  runs: "已运行", last: "上次", prompt: "提示词", session: "所属会话", unknownSession: "未知会话",
  execution: "执行方式",
  executionNote: "触发时向所属会话发送提示词，并直接沿用该会话的当前配置（未绑定独立模型）。",
  scheduleID: "任务 ID", sessionID: "会话 ID",
  statuses: { all: "全部", active: "运行中", paused: "已暂停", done: "已结束" },
  outcomes: { fired: "已触发", late: "延迟触发", skipped: "已跳过", disabled: "已禁用", failed: "失败" },
  done: "完成", backToList: "返回列表", clickWindow: "点击此窗口", keyboardElsewhere: "使用快捷键（键盘当前在输入框）",
  close: "关闭", select: "选择", onlyCurrent: "仅当前会话", search: "搜索", refresh: "刷新",
  pause: "暂停", resume: "恢复", remove: "删除", openSession: "打开会话", readIssues: "读取问题",
  back: "返回", clearSearch: "清除搜索", refreshing: "刷新中…", processing: "处理中…",
  searchPlaceholder: "搜索名称、提示词或会话", selectTask: "选择一个任务查看详情",
  reading: "正在读取任务…", readFailed: "任务读取失败，按 r 重试",
  noCurrent: "当前不在会话中，按 s 查看所有会话", noMatches: "没有符合条件的任务",
  noSessionTasks: "这个会话还没有定时任务。直接让 agent 安排即可，例如「每个工作日 9 点总结昨天的提交」",
  noTasks: "还没有任何定时任务", pausedNext: "暂停中，恢复后计算", noMoreRuns: "不再触发", unlimited: "不限", neverFired: "尚未触发",
  warningSummary: (count: number) => `⚠ ${count} 个会话的任务读取失败，列表可能不完整 · 按 w 查看`,
  warningTitle: (count: number) => `读取问题（${count}）`,
  warningHelp: "这些会话的任务无法读取，常见原因是会话所在目录已被删除或未开启 schedules。其余会话的任务不受影响。",
  runCount: (count: number, remaining?: number) => `${count} 次${remaining !== undefined ? ` · 剩余 ${remaining} 次` : ""}`,
  nextTime: (clock: string, relative: string) => `${clock}（${relative}）`,
  whenIn: (value: string) => `延时 ${value}`, whenAt: (value: string) => `指定时间 ${value}`, whenEvery: (value: string) => `每隔 ${value}`,
  today: "今天", tomorrow: "明天", yesterday: "昨天", soon: "即将", justNow: "刚刚",
  relative: (value: number, unit: "minute" | "hour" | "day", future: boolean) => `${value} ${{ minute: "分钟", hour: "小时", day: "天" }[unit]}${future ? "后" : "前"}`,
  sessionRequired: "请先打开一个会话，再查看定时任务。",
  resumeTitle: "恢复定时任务", resumeMessage: "过期的一次性任务可能立即触发；重复任务从下一个时间槽恢复。是否继续？",
  deleteTitle: "删除定时任务", deleteMessage: (name: string, session: string) => `确定删除「${name}」吗？\n所属会话：${session}\n此操作无法撤销。`,
  confirmDelete: "确认删除", cancel: "取消", commandTitle: "定时任务", commandDescription: "查看和管理会话定时任务",
}

const en: typeof zh = {
  title: "Schedules", current: "Current session", allSessions: "All sessions",
  status: "Status", task: "Task", plan: "Schedule", next: "Next", timeZone: "Time zone", ends: "Ends",
  runs: "Runs", last: "Last", prompt: "Prompt", session: "Session", unknownSession: "Unknown session",
  execution: "Execution",
  executionNote: "When triggered, the prompt is sent to the owning session using that session's current configuration (no separate model is bound).",
  scheduleID: "Schedule ID", sessionID: "Session ID",
  statuses: { all: "All", active: "Active", paused: "Paused", done: "Done" },
  outcomes: { fired: "Fired", late: "Fired late", skipped: "Skipped", disabled: "Disabled", failed: "Failed" },
  done: "Done", backToList: "Back to list", clickWindow: "Click this window", keyboardElsewhere: "for shortcuts (keyboard is in the input)",
  close: "Close", select: "Select", onlyCurrent: "Current session only", search: "Search", refresh: "Refresh",
  pause: "Pause", resume: "Resume", remove: "Delete", openSession: "Open session", readIssues: "Read issues",
  back: "Back", clearSearch: "Clear search", refreshing: "Refreshing…", processing: "Processing…",
  searchPlaceholder: "Search names, prompts or sessions", selectTask: "Select a task to view details",
  reading: "Reading tasks…", readFailed: "Could not read tasks; press r to retry",
  noCurrent: "No current session; press s to view all sessions", noMatches: "No matching tasks",
  noSessionTasks: "This session has no scheduled tasks. Ask the agent to schedule one, e.g. “Summarize yesterday's commits at 9 on weekdays”.",
  noTasks: "No scheduled tasks yet", pausedNext: "Paused; recalculated on resume", noMoreRuns: "Will not run again", unlimited: "Unlimited", neverFired: "Not yet fired",
  warningSummary: (count) => `⚠ Could not read tasks from ${count} session(s); list may be incomplete · Press w`,
  warningTitle: (count) => `Read issues (${count})`,
  warningHelp: "Tasks in these sessions could not be read. The session directory may have been deleted or schedules may be disabled. Other sessions are unaffected.",
  runCount: (count, remaining) => `${count} run(s)${remaining !== undefined ? ` · ${remaining} remaining` : ""}`,
  nextTime: (clock, relative) => `${clock} (${relative})`,
  whenIn: (value) => `In ${value}`, whenAt: (value) => `At ${value}`, whenEvery: (value) => `Every ${value}`,
  today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday", soon: "Soon", justNow: "Just now",
  relative: (value, unit, future) => { const text = `${value} ${unit}${value === 1 ? "" : "s"}`; return future ? `in ${text}` : `${text} ago` },
  sessionRequired: "Open a session first to view scheduled tasks.",
  resumeTitle: "Resume scheduled task", resumeMessage: "An overdue one-time task may fire immediately; repeating tasks resume at the next time slot. Continue?",
  deleteTitle: "Delete scheduled task", deleteMessage: (name, session) => `Delete “${name}”?\nSession: ${session}\nThis cannot be undone.`,
  confirmDelete: "Delete", cancel: "Cancel", commandTitle: "Show or hide scheduled tasks", commandDescription: "View and manage session scheduled tasks",
}

export function words(language: Language = detectLanguage()) { return language === "zh" ? zh : en }
