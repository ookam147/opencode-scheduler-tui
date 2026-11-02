# Changelog

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
- 修正英文旧版文档的截图路径。

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
