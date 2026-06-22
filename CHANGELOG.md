# Changelog

本项目的所有重要变更都记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
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
- `larkaq install` 登录后**自动写入你本人的 `notify.user_open_id`**(从 `lark-cli auth status`
  的 `openId` 取),不再需要手动查 open_id 才能让 bot 给自己发消息。

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

[Unreleased]: https://github.com/diguike/lark-ai-task-queue/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/diguike/lark-ai-task-queue/releases/tag/v0.2.0
[0.1.0]: https://github.com/diguike/lark-ai-task-queue/releases/tag/v0.1.0
