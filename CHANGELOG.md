# Changelog

## [3.0.0] - 2026-11-24

迁移到 OpenCode 2.4 原生 Automation，需要 OpenCode 2.4.0 及以上（已核对 2.4.0 / 2.4.1）。界面架构保持不变。

### ⚠️ 破坏性变更

- **底层 API**：`experimental.schedule.*` 在 2.4.0 中已移除，改用 `experimental.automation.*`（`automationID` 替代 `scheduleID`）。不再支持 OpenCode 2.4.0 以下版本。
- **命令**：`/schedule_status` → `/automation_status`；命令面板标题改为 “Show or hide automations”。
- **依赖**：`@opencode/*` 2.2.5 → 2.4.0，OpenTUI 0.8.0 → 0.9.4；对等依赖改为 `@opencode/plugin >=2.4.0 <3`、OpenTUI `>=0.9.4`。
- **配置**：不再需要 `experimental.schedules`（2.4 已移除）；Automation 默认开启，用顶层 `"automations": false` 关闭。

### 变更

- **数据模型**：`when` → `trigger`（新增 MCP `event`），`prompt` → `action`（`prompt` / 子代理 / `code` / `shell`），`endsAt` → `expires`，`lastFiredAt` → `lastRunAt`；移除 `if` / `until` 条件门控与 `checked` 结果。
- **性能**：一次请求读取全部 Automation，「当前 / 所有会话」本地筛选；移除会话遍历、分页、4 路并发、本地目录检查与部分失败警告（`w` 键）。全局视图也每 5 秒刷新。
- **会话信息**：标题改读宿主 `context.data.session` 缓存，不再请求会话接口。「当前会话」同时包含投递到本会话的任务；`o` 打开投递目标会话。

### 新增

- **设置**：窗口内按 `c` 或命令面板「自动化任务设置」。可设置界面语言（简体中文 / English）、自动刷新间隔（5 / 10 / 30 / 60 秒或关闭）、排序方式（创建时间 / 下次运行 / 名称）、时间显示（相对 / 具体时间）、默认范围与默认状态；由宿主插件存储持久化，多个 TUI 同步。界面语言不再按电脑时区判断，默认简体中文。
- 列表以 `↳` / `λ` / `$` 标记子代理、Code、Shell 动作；上次失败的任务标注「失败」。
- 详情展示动作类型与内容、投递目标、执行说明、事件参数与**上次输出**（服务端现于 list 返回）。
- `at` 触发按本地时间显示；事件监听的「下次」显示为「收到事件时」。

---

## [2.0.0] - 2026-11-02

改为 OpenCode 原生 schedule 的管理界面，需要 OpenCode 2.2.3 及以上（已核对 2.2.5）。

### ⚠️ 破坏性变更

- **移除旧版 OS 调度实现**：插件不再安装 launchd / systemd / cron / schtasks 任务，不再启动 `opencode run`，也不再提供 `schedule_job`、`scheduler_status`、`cleanup_global` 等旧工具。调度、存储与投递全部交给 OpenCode Service，创建任务由 agent 调用原生 `schedule_create`。
- **旧任务不会自动迁移或清理**：已安装的系统定时器可能仍在运行，需按 `docs/legacy-readme.zh-CN.md` 所述位置手动盘点停用，再按会话重新创建原生任务。
- **依赖调整**：`@opencode/plugin` 改为可选的对等依赖（`>=2.2.3 <3`），由宿主提供，不再随插件安装；移除 `@opencode-ai/plugin`、`cron-parser`。安装不再需要 `--legacy-peer-deps`。

### 新增

- **原生任务窗口**：`/schedule_status` 打开，显示在输入框上方；支持当前会话 / 所有会话、状态筛选、搜索、暂停 / 恢复、确认删除、打开所属会话；中英文界面。
- **条件任务**：列表以 `◆` 标记（`if` 为主题 warning 色，`until` 为主题 info 色），详情展示检查命令、判定方式与说明；`checked`、`expired` 结果有对应文案；最近一次检查未通过的条件任务在列表中标注「等待条件」。

### 修复

- 「所有会话」视图跳过目录已删除的会话，不再误报为读取失败。
- 英文界面「Next」列放宽，`in 58 minutes` 等相对时间不再被截断。
- 修正英文旧版文档的截图路径；README 换用原生窗口的中英文截图。

---

## [1.4.1] - 2026-07-28

- **侧栏顺序**：Scheduler 固定显示在 Quota 下方、MCP 上方
- **状态颜色**：Paused 使用主题蓝色，任务中心入口使用标题文本色

---

## [1.4.0] - 2026-07-20

基于 upstream v1.3.0 的 fork 版本，新增以下功能：

- **TUI 任务中心**：鼠标交互式任务管理界面，支持搜索 / 过滤 / 立即运行 / 暂停恢复 / 编辑计划 / 查看日志 / 运行历史
- **可观测性 API**：OS 级调度器状态校验（`scheduler_status`）
- **会话侧边栏**：项目级任务列表，含 Active / Paused / Error 状态计数
- **全局清理工具**：跨作用域批量清理调度器残留（`cleanup_global`）

---

## [1.3.0] - 2026-02-22 (upstream)

- 作用域存储架构
- supervisor 管道（无重叠 + 超时）
- Windows Task Scheduler 支持

## [1.0.0] – [1.2.0] (upstream)

- 核心调度功能（launchd / systemd / cron）
- Job CRUD、锁文件、日志管道
- 作用域隔离
