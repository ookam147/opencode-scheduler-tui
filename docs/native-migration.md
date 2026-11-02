# 原生 Schedule 迁移说明

## 本次边界

package exports 只指向 `src/native/` 对应构建产物。旧版 OS 调度实现（`src/index.ts`、`src/server.ts`、`src/status.ts`、`src/tui.tsx` 及其测试、构建产物和 `@opencode-ai/plugin`、`cron-parser` 依赖）已删除；需要参考时请查看 1.4.1 及更早的 Git 历史。旧版的 `cleanup_global` 等清理工具也随之移除，旧系统任务需按[旧版文档](./legacy-readme.zh-CN.md)所述位置手动盘点。没有修改 `AGENTS.md`、`opencode.json`、用户 CLI 配置或任何 OS 定时任务。

因此，已有 launchd/systemd/cron/schtasks 任务可能仍在后台运行。**切换插件入口不等于停掉旧任务**。应先盘点，再经确认停用旧系统任务，最后按会话重新创建原生任务，防止重复执行。不要把 shell 脚本、独立工作目录或旧权限设置无损映射为 prompt。

## 原生 API 契约（OpenCode 2.2.1）

- `client.experimental.schedule.list({sessionID})`
- `create(...)` 存在，但插件不调用：任务由 agent 通过原生 `schedule` 工具创建。
- `pause({scheduleID})` / `resume({scheduleID})`
- `delete({scheduleID})`：返回 void，对应 HTTP 204
- SDK 已解包 HTTP data，无需再访问 `response.data`。
- 创建时 `when` 恰好一个键：`in / at / every / cron`；返回值 `when` 才带 `type`。
- `tz` 在创建输入的 `when` 内；不填则继承服务端配置，不使用客户端时区偷偷覆盖。
- `Schedule.Info` 的时间字段来自 `DateTimeUtcFromMillis`，按毫秒处理。
- `ends` 原生可组合多个上限并在最早达到的限制处停止。
- 无跨会话 schedule list、更新、立即运行或完整逐次日志接口。

数据层以 `session.list` 分页聚合所有会话，只取会话元数据，不请求对话正文。每次最多四个并发任务列表请求，取消可中止，部分失败显式展示。后台 Service 是否可达、各会话功能开关和访问权限决定实际可见范围。

会话关联信息来自 `session.get` / `session.list`，不直接 JOIN `session_v2`。详情不展示 Agent、模型、提供商或推理档位：会话当前选择不应被误解为任务锁定的执行配置，也不是历史执行快照。

UI 的 `d` 操作经过确认后调用 `experimental.schedule.delete`。它与 agent 使用的原生删除工具作用于同一任务，并不绕过服务端 API 或删除会话记录。中英文自动选择基于用户本机 IANA 时区，采用明确的中文区域映射，其余使用英语；这是启发式规则，不应把任务时区或会话项目目录当作用户语言。

## 模块划分

| 模块 | 职责 |
|---|---|
| `src/native/model.ts` | 纯展示模型、搜索、过滤与计数 |
| `src/native/client.ts` | 官方 SDK 适配、分页与限并发聚合 |
| `src/native/room.ts` | 计算对话框上方可占用的高度（不覆盖输入框、侧边栏） |
| `src/native/window.tsx` | 宿主无关 OpenTUI 视图及键鼠交互 |
| `src/native/tui.tsx` | V2 `session.composer.top` 插槽、命令、焦点、主题、刷新与原生操作接线 |
| `src/native/server.ts` | 无副作用的 V2 服务端发现入口 |

UI 仅借鉴 `opencode-quota` 的固定外壳、分类 rail、焦点和滚动分区模式，未复制其源代码，也未修改参考项目。

## 验证范围

测试覆盖纯模型、真实 SDK 契约的 fake transport、跨会话分页/并发/失败/取消、真实 OpenTUI 测试渲染器的宽窄屏/搜索隔离/选择/操作，以及 V2 宿主插槽/命令生命周期接线、对话区高度计算。

另已通过本机运行中的 Service 对当前会话执行只读列表请求，无警告。没有为了测试创建真实定时任务。真实宿主中的热加载、人工键鼠体验及创建/暂停/删除端到端流程，仍需加载插件后验收；测试渲染器不等同于真实宿主实机验证。

## 依赖注意

目标 SDK 为 `@opencode/plugin@2.2.3`，OpenTUI 为 0.8.0，与宿主 2.2.3 的 catalog 一致（`@opencode/plugin@2.2.3` 的 peer 要求 `@opentui/core >= 0.8.0`）。运行时 SDK/OpenTUI/Solid 均保持 external，避免与宿主的响应式实例混用。`@opencode/client` 需显式声明为开发依赖，否则会被嵌套安装而导致根级类型导入无法解析。

安装时 npm 对 Node 24 发出 OpenTUI Node>=26.4.0 引擎警告；构建测试使用 Bun 1.4.4。依赖审计仍有上游告警，尚未通过跨版本强制升级处理，不应宣称零漏洞。

## 条件门控（2.2.3 新增）

迁移 `20261029165540_schedule_checks` 为 `schedule` 表增加 `check`、`checks`、`failures`、`state` 四列。`Schedule.Info` 随之新增 `if`、`until`、`lastOutput`，`lastOutcome` 扩充 `checked` 与 `expired`。底层只存一个 `check`（含 `mode: "if" | "until"`），因此 `if` 与 `until` 互斥，插件以 `scheduleCheck()` 归一读取。

HTTP 路由未变（create/list/get/pause/resume/delete），SDK 层时间戳仍是 epoch 毫秒；Code Mode 工具签名展示的 ISO 字符串属工具层表示，不影响本插件。`when` 在请求层变为可选（配合 `until` 时服务端默认 `{ every: "30 seconds" }`），但 `Schedule.Info.when` 仍必填，故数据模型无需放宽。

`lastOutput` 仅在 `create` 的返回值中由 `toInfo(row, seeded.message)` 填充，`list` 与 `get` 一律不带该字段，故只读窗口不展示它。shell 条件的 `is`/`matches`/`changes` 三者服务端限定最多选一；`expired` 表示 `until` 超时后仍会唤醒会话并在提示词后追加未匹配说明。

「检查失败」指检查本身出错（超过 30 秒、带判定时命令非零退出、agent 缺失、权限拒绝等），不是条件不成立：条件不成立记为 `checked`，不计次。出错后 1 分钟重试（`CHECK_FAILED_RETRY`），连续 3 次（`MAX_CHECK_FAILURES`，上游硬编码、不可配置）即置为 paused；检查写法无效（如非法正则）则不重试直接暂停。暂停时会附带 `[Schedule paused after N failed checks: …]` 发送一次提示词。注意 `matches` 用未 trim 的原始 stdout 匹配，`is` 会 trim。

以上条件门控语义已核对 2.2.3 与 2.2.5 一致（`schedule/check.ts` 无差异）；2.2.5 在调度层仅新增同一数据目录下的主进程选举（lease 行，防止多进程重复触发），不影响本插件。
