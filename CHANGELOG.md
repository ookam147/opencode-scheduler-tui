# Changelog

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
