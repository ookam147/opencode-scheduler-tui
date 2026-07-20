# opencode-scheduler

> 📖 [English](./README.md) | 简体中文

> Forked from [different-ai/opencode-scheduler](https://github.com/different-ai/opencode-scheduler)，新增 TUI 任务中心、可观测性面板等增强功能。

按计划运行 AI Agent，设置自动执行的周期性任务——即使你不在电脑前。

```
Schedule a daily job at 9am to search Facebook Marketplace for posters under $100 and send the top 5 deals to my Telegram
```

这是一个 [OpenCode](https://opencode.ai) 插件，使用操作系统原生调度器（macOS 的 launchd、Linux 的 systemd、Windows 的 Task Scheduler），在不支持原生后端的平台上使用 cron 作为回退方案。

截至 `v1.4.0`，插件包含 OS 级状态校验 API 和鼠标交互式 TUI 任务中心。任务按 `workdir` 隔离，定时运行受 supervisor 监管（无重叠 + 可选超时）。

## ✨ Fork 增强功能

本 Fork 相对于 upstream [different-ai/opencode-scheduler](https://github.com/different-ai/opencode-scheduler) 新增了以下功能：

| 功能 | 说明 |
|------|------|
| **TUI 任务中心** | 鼠标交互式任务管理界面，支持搜索、过滤、立即运行、暂停 / 恢复、编辑计划、查看日志、运行历史 |
| **可观测性 API** | OS 级调度器状态校验，自动检测孤儿任务和健康状态 |
| **会话侧边栏** | 项目级任务列表，含 Active / Paused / Error 紧凑状态计数 |
| **跨项目切换** | 在 TUI 中切换项目作用域，查看和管理不同项目的任务 |
| **全局清理** | 跨作用域批量清理调度器残留文件和 OS 定时任务 |

## 安装

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-scheduler"]
}
```

### TUI 任务中心（OpenCode 1.18.3+）

通过 OpenCode 插件安装器安装后，server 和 TUI 入口会自动发现。已有用户还需将包添加到 `tui.json`（全局 `~/.config/opencode/tui.json` 或项目 `.opencode/tui.json`）：

```json
{
  "plugin": ["opencode-scheduler"]
}
```

重启 OpenCode 后，运行 `/scheduler` 或在命令面板选择 **Open scheduled tasks**。任务中心以当前项目为作用域，支持鼠标选择、跨项目切换、搜索 / 过滤、立即运行、暂停 / 恢复、编辑计划、查看日志、运行历史、确认删除、以及将旧任务迁移到当前项目。

会话侧边栏仅显示当前项目拥有的任务。任务列表可折叠，同时保持 Active / Paused / Error 紧凑计数可见。这些计数为只读；使用右侧蓝色箭头和总数打开任务中心。调度器存储变更会被实时监听，Agent 创建的任务无需等待周期性校验即可出现。

任务列表默认获取焦点。使用 `Tab` 在列表、顶部控件和搜索间切换；使用 `←` / `→` 或 `h` / `l` 加 `Enter` 应用项目 / 状态过滤器。使用 `↑` / `↓` 或 `j` / `k` 浏览任务，`/` 搜索，`r` 刷新，`Esc` 返回。任务行、过滤器、操作和滚动也支持鼠标。

## 使用示例

**每日比价：**
```
Schedule a daily job at 9am to search for standing desks under $300
```

**每周报告：**
```
Schedule a job every Monday at 8am to summarize my GitHub notifications
```

**定时提醒：**
```
Schedule a job every 6 hours to check if my website is up and alert me on Slack if it's down
```

## 命令

| 命令 | 示例 |
|------|------|
| 创建任务 | `Schedule a daily job at 9am to...` |
| 列出任务 | `Show my scheduled jobs` |
| 校验系统状态 | `Show scheduler status across all projects` |
| 暂停 / 恢复 | `Pause standing-desk` / `Resume standing-desk` |
| 查看版本 | `Show scheduler version` |
| 安装 Skill 模板 | `Install the scheduled job best practices skill` |
| 查看任务详情 | `Show details for standing-desk` |
| 更新任务 | `Update standing-desk to run at 10am` |
| 立即运行 | `Run the standing-desk job now` |
| 查看日志 | `Show logs for standing-desk` |
| 删除任务 | `Delete the standing-desk job` |
| 全局清理（dry run） | `Run scheduler global cleanup` |

## 工作原理

1. 用自然语言描述你要调度的任务
2. 插件写入任务文件（按 `workdir` 隔离）并在 OS 调度器中安装定时器
3. 到达调度时间时，OS 调度器调用一个小型 supervisor 脚本
4. supervisor 运行任务、追加日志、更新任务元数据

也可以通过 `run_job` 立即触发任务——fire-and-forget，追加到同一日志文件。

任务从创建时的工作目录运行，自动读取该目录的 `opencode.json` 和 MCP 配置。

### 可靠性保证（定时运行）

- **无重叠**：上一次运行仍在进行时，跳过下一次调度。
- **默认非交互**：定时运行强制 `OPENCODE_PERMISSION` 拒绝 "question" 提示，任务不会卡在审批环节。
- **可选超时**：设置 `timeoutSeconds` 硬停止长时间运行（SIGTERM，然后 SIGKILL）。

### 平台支持

| 平台 | 调度后端 | 备注 |
|------|----------|------|
| macOS | `launchd` | 完整支持（supervisor 监管定时运行） |
| Linux（有 systemd） | `systemd --user` | 完整支持（supervisor 监管定时运行） |
| Linux / POSIX（无 systemd） | `cron`（`crontab`） | 回退后端（无漏跑补偿） |
| Windows | `schtasks`（Task Scheduler） | 支持部分 cron 表达式映射（见下方限制） |

Windows Task Scheduler 限制：

- 不支持的 cron 组合（如 month + weekday 约束、或仅有 month 无 day-of-month）会返回明确错误和指引。
- 复杂 cron 计划可能展开为多个 Windows 任务，名称为 `\\OpenCode\\opencode-job-...`。
- Windows 定时运行目前**不**使用 macOS / Linux 的 supervisor 管道，无重叠和超时执行不保证。

---

## 参考

### Cron 语法

任务使用标准 5 字段 cron 表达式：

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

| 表达式 | 含义 |
|--------|------|
| `0 9 * * *` | 每天 9:00 |
| `0 */6 * * *` | 每 6 小时 |
| `30 8 * * 1` | 每周一 8:30 |
| `0 9,17 * * *` | 每天 9:00 和 17:00 |

### 工具

| 工具 | 说明 |
|------|------|
| `schedule_job` | 创建定时任务 |
| `list_jobs` | 列出所有定时任务 |
| `scheduler_status` | 校验任务与 OS 调度器一致性，报告健康状态 / 孤儿任务 |
| `get_version` | 显示调度器和 opencode 版本 |
| `get_skill` | 获取内置 Skill 模板（最佳实践） |
| `install_skill` | 将内置 Skill 安装到你的仓库 |
| `get_job` | 获取任务详情和元数据 |
| `update_job` | 更新已有任务 |
| `delete_job` | 删除定时任务 |
| `pause_job` / `resume_job` | 暂停（不删除）/ 恢复任务 |
| `repair_job` | Dry-run 或执行重装 / 孤儿清理 |
| `cleanup_global` | 跨作用域清理调度器残留（默认 dry-run） |
| `run_job` | 立即执行任务（fire-and-forget） |
| `job_logs` | 查看任务最新日志 |

`schedule_job` 和 `update_job` 接受可选的 `timeoutSeconds`（整数秒）。设 `0` 或省略则禁用。

工具接受可选的 `format: "json"` 参数，返回结构化输出（`success`、`output`、`shouldContinue`、`data`）。

### 全局清理

使用 `cleanup_global` 清理所有作用域的调度器残留。默认 dry-run，需传 `confirm: true` 才执行。

```json
{ "confirm": false }  // dry run（安全默认）
{ "confirm": true }   // 执行清理
{ "confirm": true, "includeHistory": true }  // 同时删除日志和运行历史
```

报告精确到每种残留类型的删除数量（jobs、locks、logs、runs、launchd / systemd units）。

### 存储路径

| 内容 | 路径 |
|------|------|
| 任务配置（按作用域） | `~/.config/opencode/scheduler/scopes/<scopeId>/jobs/*.json` |
| 运行记录（按作用域） | `~/.config/opencode/scheduler/scopes/<scopeId>/runs/*.jsonl` |
| 锁文件（按作用域） | `~/.config/opencode/scheduler/scopes/<scopeId>/locks/*.json` |
| 日志（按作用域） | `~/.config/opencode/logs/scheduler/<scopeId>/*.log` |
| Supervisor 脚本 | `~/.config/opencode/scheduler/supervisor.pl` |
| launchd plists（Mac） | `~/Library/LaunchAgents/com.opencode.job.<scopeId>.*.plist` |
| systemd units（Linux） | `~/.config/systemd/user/opencode-job-<scopeId>-*.{service,timer}` |
| Task Scheduler（Windows） | `\\OpenCode\\opencode-job-<scopeId>-*` |

Legacy 说明：旧版本将任务存储在 `~/.config/opencode/jobs/*.json`，使用非作用域化的 unit 名称。`delete_job` 同时清除作用域化和 legacy 残留。

### 工作目录

任务从指定目录运行以读取 MCP 配置：

```
Schedule a daily job at 9am from /path/to/project to run my-task
```

默认使用创建任务时的工作目录。

### 作用域

作用域由任务的 `workdir`（规范化绝对路径）派生，隔离任务存储、日志和 OS 调度器 unit 名称。

- `list_jobs` 默认返回**当前作用域**的任务。
- `allScopes: true` 列出所有作用域的任务。
- `includeLegacy: true` 包含 pre-`v1.2.0` 存储在 `~/.config/opencode/jobs` 的任务。

### Attach URL（可选）

如果你通过 `opencode serve` 或 `opencode web` 运行 OpenCode 后端，可以为任务设置 `attachUrl`，使运行时使用该后端：

```
Update the standing-desk job to use attachUrl http://localhost:4096
```

## 项目理念

- 本插件是有意的薄封装：通过 launchd / systemd / schtasks 调度 `opencode run`，不支持原生后端时回退到 cron。
- 日志是定时运行的唯一真相来源：`~/.config/opencode/logs/*.log`。
- 弹性 / 报告路线图（未实现）：`PRD-resilient-execution.md`。

### 内置 Skill 模板

在 OpenCode 中打开你的仓库，运行以下命令安装内置 Skill（无需手动复制）：

```
Install the scheduled job best practices skill
```

这会调用插件的 `install_skill` 工具，写入 `.opencode/skill/scheduled-job-best-practices/SKILL.md`。

然后在定时任务 prompt 顶部添加 `@scheduled-job-best-practices`。

## 故障排除

**任务不运行？**

1. 检查是否已安装：
   - Mac：`launchctl list | grep opencode`
   - Linux：`systemctl --user list-timers | grep opencode`
   - Windows：`schtasks /Query /TN "\\OpenCode\\opencode-job-*"`

2. 检查日志：`Show logs for my-job`

3. 确认工作目录有正确的 `opencode.json`（含 MCP 配置）

**MCP 工具不可用？**

确保任务的工作目录包含配置了 MCP server 的 `opencode.json`。

## 许可证

MIT
