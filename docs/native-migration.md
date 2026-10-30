# 原生 Schedule 迁移说明

## 本次边界

默认 package exports 已切换到 `src/native/` 对应构建产物。旧 `src/index.ts`、`src/status.ts`、`src/tui.tsx` 保留用于回归和参考，不会从新默认入口加载。没有修改 `AGENTS.md`、`opencode.json`、用户 CLI 配置或任何 OS 定时任务。

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

目标 SDK 为 `@opencode/plugin@2.2.1`，OpenTUI 为 0.7.0，运行时 SDK/OpenTUI/Solid 均保持 external，避免与宿主的响应式实例混用。旧 SDK 和 cron-parser 仅供源码回归开发使用。

安装时 npm 对 Node 24 发出 OpenTUI Node>=26.4.0 引擎警告；构建测试使用 Bun 1.3.14。依赖审计仍有上游告警，尚未通过跨版本强制升级处理，不应宣称零漏洞。
