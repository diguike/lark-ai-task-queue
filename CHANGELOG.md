# Changelog

本项目的所有重要变更都记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **按需推送(`notify.when`)**:默认 `on_activity` —— **无事不打扰**,仅当本轮有实质活动
  (任务完成并有产出/动作、等你确认、失败、或条件型任务达到通知条件)才推送飞书消息;
  空轮、"无未读/波动不大/无变化/无需动作"只写本地日志、不推送。另可 `always`(每轮都发,
  旧行为)/`off`(从不;框架级硬跳过,不依赖提示词)。**任务级评论(留痕)与推送解耦**:
  重复任务"检查后无变化"仍回写一条简短评论让间隔/cron 状态机知道本周期已查过,但不触发推送。
  `run-queue.md` 步骤 4 重写为事件驱动判定;`notify.when` 接入校验、`config nl` 白名单与 `doctor`。
- **可插拔 AI 执行器(`execution.agent`)**:无人值守执行队列的编码代理可配置,
  默认 `claude`(Claude Code),可选 `codex`(OpenAI Codex CLI)。新增适配层
  `core/engine.mjs`,把"非交互 + 跳过确认 + 能跑 shell/联网"的契约收敛成纯函数
  `buildAgentCommand`(claude → `-p … --add-dir … --dangerously-skip-permissions`;
  codex → `exec --dangerously-bypass-approvals-and-sandbox -C … <prompt>`)。
  `run`、`doctor` 与 `config nl` 的可设字段均接入;`run-queue.md` 提示词两引擎通用。
  纯逻辑有单测。`config nl` 的一次性配置推理仍固定用 claude(其 stdout 为可解析 JSON)。

### Changed
- 空队列不再推送"本轮无待办"(旧版会发一条),改为静默只记日志。

## [0.3.0] - 2026-06-24

### Added
- **cron 表达式调度 + 每日定点**:标题/描述带 `[cron: 分 时 日 月 周]`(标准 5 字段,支持
  `*` / `a-b` / `*/n` / `a-b/n` / 列表,周字段 `0`/`7` 皆为周日,日与周都受限时按 Vixie cron 取并集)
  可精确控制时点,如 `[cron: 0 9 * * 1-5]`(工作日 9 点)。`[每日 09:00]`/`[每天 18:00]` 是其语法糖。
  判定语义为"上次成功后是否又跨过一个 cron 匹配点"(轮询式,逐分钟回扫最多 35 天封顶)。优先级
  **cron > 间隔 > 自然日标记**。叠加活跃时段窗口时,cron 命中点本身须落在窗口内才算到期
  (窗口外的命中点不补跑)。写错的频率标记(`[cron: 99 …]`/`[每日 25:00]`/`[每0分钟]`/`[25:00-26:00]`)
  按 fail-closed 处理:仍视为重复任务(不会被当一次性任务划掉),但本轮不执行、停在队列等修正。
  `zonedParts` 的 `Intl` formatter 按时区缓存(最坏回扫提速约 10×)。纯逻辑
  (`parseCronField`/`parseCronExpr`/`parseSchedule`/`cronMatches`/`cronDue`/`hasScheduleMarker`、
  `util.zonedParts`)有单测。
- **小时/分钟级重复任务**:标题/描述带 `[每30分钟]`/`[每1小时]`/`[每2小时]`/`[每2天]`
  (也认 `[每30m]`/`[每2h]`/`[每1d]`)→ 按"距上次成功结果评论的时长 ≥ 间隔"滚动判定,
  补齐飞书原生重复规则只到天/周的空缺。无参数标记 `[每日]` 仍按自然日对齐(向后兼容)。
  可叠加活跃时段窗口 `[09:00-22:00]`(支持跨午夜如 `[22:00-02:00]`),窗口外即便到点也不执行。
  纯逻辑(`parseEveryInterval` / `parseActiveWindow` / `withinActiveWindow` /
  `lastRecurringSuccessAt`)有单测。注意:间隔精度受守护进程心跳频率限制,半小时级需把
  `poll_interval_minutes` 与调度器触发间隔压到 5–10 分钟。
- **尊重飞书"开始时间"**:设了开始时间的任务,到点前不会被执行(`queue pull` 预筛阶段
  按 `start.timestamp` 过滤;`is_all_day` 则按时区当天起算)。未设开始时间的任务行为不变。
- **自然语言配置 `larkaq config nl "<意图>"`**:把意图交给 Claude,按配置 Schema 翻成结构化改动,
  逐项过 `validateConfig` + 白名单闸门再写入(非法值/越权 path 一律拒绝),打印 before→after
  与还原命令;`--dry-run` 可预览。纯逻辑(`extractJsonObject` / `vetChanges`)有单测。
- GitHub Actions CI(矩阵 node 18/20/22/24 跑 `node --test` + CLI 冒烟)。
- `larkaq --version` / `-v`。
- `SECURITY.md`、issue/PR 模板、`CHANGELOG.md`、`.nvmrc`。
- `lock.mjs` 陈旧锁接管、`lark.mjs` 翻页汇总(`collectPaged`)的单元测试。
- 英文 `README.en.md` 与架构/状态机图(`ARCHITECTURE.md`)。

### Changed
- **默认轮询间隔 60 → 30 分钟**(`config.example.json` 与三个调度器模板
  launchd/systemd/cron 同步),以支撑小时/半小时级重复任务的精度。
- `larkaq install` 登录后**自动写入你本人的 `notify.user_open_id`**(从 `lark-cli auth status`
  的 `openId` 取),不再需要手动查 open_id 才能让 bot 给自己发消息。
- README 精简:去掉与顶部流程图重复的 ASCII 工作流,新增「更多文档」导航。

### Removed
- 删除构建期遗留的 `NOTES.md`(lark-cli 命令摸底,已被 `src/core/lark.mjs` 封装取代)
  与 `prompts/IMPLEMENTATION.md`(把脚手架实现出来的一次性启动提示词,项目已完成)。

### Fixed
- **Node 23+ 兼容**:新版 `node --test` 不再把 `test/` 当目录(会报 MODULE_NOT_FOUND)。
  改用 `node --test`(无参自动发现),在 node 18/20/22/23/24 上一致工作;CI 矩阵补 node 24。
- 移除 `doctor` 里过时的 `curl` 检查(项目已不依赖 curl)。

## [0.2.0] - 2026-06-23

### Changed
- **全量重构为纯 Node.js CLI**。核心依赖从 lark-cli/claude/jq/curl 收敛到只剩
  **lark-cli + claude**(node 随 lark-cli 必然存在;JSON 用 Node 解析、webhook 用内置
  `fetch`,去掉 jq/curl)。
- 统一命令行入口 `larkaq`,子命令 `install`/`doctor`/`config`/`run`/`start`/`stop`/`status`/`logs`,
  以及给 AI 执行器的原子操作(`queue pull`/`comment`/`complete`/`doc`/`notify`/`confirm-state`/…)。
- `src/core` 纯逻辑与 I/O 分离,唯一 spawn `lark-cli` 处收敛在 `core/lark.mjs`。
- 旧 `scripts/*.sh` 改为兼容转发(`→ node bin/larkaq …`),不破坏既有 launchd/cron/systemd。

### Added
- 跨平台:全 Node 实现,消除 bash 可移植性坑;部署模板补 `PATH`/`HOME`。
- 重复任务"每日"判定支持 `execution.timezone`。
- `node:test` 单测(纯逻辑覆盖)。
- `config set` 取值校验;lark 列表/评论全量翻页。

### Fixed
- 预筛先按可执行性过滤再截断(前 N 条等确认时不再饿死后面可执行任务)。
- 锁接管改原子 rename + stale TTL,消除"读不到 owner 即接管"的双实例竞态。
- 确认状态机:确认请求须以哨兵开头(用户引用 marker 不再误判 waiting)。
- 重复任务只把成功(✅)评论算"今日已干",失败评论不阻断当日重试。
- `claude` 被信号杀死 / 非零退出不再被吞成成功。
- `notify` 内部 catch,保证不在错误路径二次抛错。

## [0.1.0] - 2026-06-21

### Added
- 初版:把飞书任务清单当作寄给 AI 的待办队列(bash + jq 实现)。前缀自动发现、
  异步人工确认、重复任务、每轮飞书推送、用户态 daemon 与 launchd/cron/systemd 模板。

[Unreleased]: https://github.com/diguike/lark-ai-task-queue/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/diguike/lark-ai-task-queue/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/diguike/lark-ai-task-queue/releases/tag/v0.2.0
[0.1.0]: https://github.com/diguike/lark-ai-task-queue/releases/tag/v0.1.0
