# Changelog

本项目的所有重要变更都记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- GitHub Actions CI(矩阵 node 18/20/22 跑 `node --test` + CLI 冒烟)。
- `larkaq --version` / `-v`。
- `SECURITY.md`、issue/PR 模板、`CHANGELOG.md`、`.nvmrc`。
- `lock.mjs` 陈旧锁接管、`lark.mjs` 翻页汇总(`collectPaged`)的单元测试。
- 英文 `README.en.md` 与架构/状态机图(`ARCHITECTURE.md`)。

### Fixed
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
