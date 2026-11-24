# 原生 Automation 迁移说明

## 本次边界（3.0.0）

OpenCode 2.4.0 用 Automation 取代了 session 级 schedule：SDK 中 `experimental.schedule` 已删除，只剩 `experimental.automation`。本插件随之把底层 API 与数据模型迁移到 Automation，保留原有窗口架构（`session.composer.top` 插槽、分类 rail、列表/详情分区、快捷键与焦点处理）。

package exports 只指向 `src/native/` 的构建产物。没有修改 `AGENTS.md`、`opencode.json`、用户 CLI 配置或任何 OS 定时任务。旧版 OS 调度实现见 1.4.1 及更早的 Git 历史与[旧版文档](./legacy-readme.zh-CN.md)。

## 原生 API 契约（OpenCode 2.4.0）

- `client.experimental.automation.list({ sessionID?, directory? })`：两者都可省略，省略即返回服务端可见的全部任务，按 `time_created` 升序。插件只调用无参版本。
- `create(...)` 存在，但插件不调用：任务由 agent 通过 `automation` 工具或 `/automation` 创建。
- `pause({ automationID })` / `resume({ automationID })`：返回解包后的 `Automation.Info`。
- `delete({ automationID })`：返回 void，对应 HTTP 204。
- 时间字段（`nextDueAt`、`lastRunAt`、`expires`、`time.*`）为 epoch 毫秒；`trigger.at` 存为 UTC ISO 字符串，界面按本地时间显示。
- 无更新、立即运行或完整逐次日志接口。

`Automation.Info` 相比旧 `Schedule.Info` 的主要变化：

| 旧（schedule） | 新（automation） |
|---|---|
| `when`（`in/at/every/cron`） | `trigger`（`at/every/cron/event`）；`in` 改写为 `at: "in …"` 并在服务端解析成时刻 |
| `prompt` | `action`：`prompt`（`to: { session } | { subagent }`）/ `code` / `shell` |
| `if` / `until` 条件门控 | 已移除，由 `code` 动作自行判断后 `send` |
| `endsAt` / `remainingRuns` | `expires`；无剩余次数 |
| `lastFiredAt` | `lastRunAt` |
| `lastOutcome` 含 `checked` | `fired/late/skipped/disabled/failed/expired` |
| `lastOutput` 只在 create 返回 | list/get 均返回 |
| — | `name`（必填）、`projectID`、`directory`、`state` |
| `sessionID` 必有 | 可选；删除会话不删除任务 |

`state` 是 code 动作的内部 JSON 状态，每次运行都可能变化；插件在适配层丢弃它，避免无意义的重绘。

## 性能变化

旧实现必须先 `session.list` 分页遍历全部会话，再按会话 4 路并发调用 `schedule.list`，并对失败会话检查本地目录是否存在以过滤误报；全局视图因此限制为每 60 秒刷新一次，并要处理部分失败的警告。

新实现每次刷新只发一个请求：

- 移除会话遍历、分页游标检查、并发 worker、`node:fs` 目录检查、部分失败警告（`w` 键与警告面板）。
- 「当前 / 所有会话」改为本地筛选，切换范围不再重新请求；两种范围统一每 5 秒静默刷新。
- 会话标题从宿主 `context.data.session.get()` 的同步缓存读取，不再调用 `session.get` / `session.list`。
- 服务端在 `automations: false` 的目录中隐藏任务；目录已删除的任务仍可见、可删除（服务端对缺失目录视为可管理）。

## 会话归属

「当前会话」= 由本会话创建（`sessionID`）**或**提示词投递到本会话（`action.to.session`）。`o` 打开的是投递目标；子代理、code、shell 动作没有固定目标会话，则打开创建会话。详情仅在目标与创建会话不同时显示「目标」行。

## 模块划分

| 模块 | 职责 |
|---|---|
| `src/native/settings.ts` | 设置项、默认值与存储值校验 |
| `src/native/model.ts` | Automation 展示模型、会话归属、搜索、过滤与计数 |
| `src/native/client.ts` | 官方 SDK 适配：单次列表、标题拼接、取消、暂停/恢复/删除 |
| `src/native/room.ts` | 计算对话框上方可占用的高度（不覆盖输入框、侧边栏） |
| `src/native/window.tsx` | 宿主无关 OpenTUI 视图及键鼠交互 |
| `src/native/tui.tsx` | V2 插槽、`/automation_status` 命令、焦点、主题、刷新与原生操作接线 |
| `src/native/server.ts` | 无副作用的 V2 服务端发现入口 |

## 验证范围

测试覆盖纯模型、真实 SDK 类型的 fake transport（单次请求、标题拼接、取消）、真实 OpenTUI 测试渲染器的宽窄屏/搜索隔离/选择/操作/动作与触发展示，以及 V2 宿主插槽/命令生命周期接线。

另在本机 OpenCode 2.4.1 Service 上创建一条一年后触发的临时 Automation，核对 list/pause/delete 返回字段与本模型一致后立即删除。真实宿主中的人工键鼠体验仍需加载插件后验收。

## 依赖注意

开发依赖为 `@opencode/plugin` / `@opencode/client` / `@opencode/theme@2.4.0`，OpenTUI 为 0.9.4（`@opencode/plugin@2.4.0` 要求 `@opentui/core`、`@opentui/solid >=0.9.4`）。`@opencode/plugin` 对使用者是可选的对等依赖（`>=2.4.0 <3`），不写入 `dependencies`；运行时 SDK/OpenTUI/Solid 均保持 external，由宿主提供。`package-lock.json` 已重新生成：旧锁文件固定的 `effect@4.0.6` 与 `@opencode/client@2.4.0` 要求的 `effect@4.1.0` 冲突。
