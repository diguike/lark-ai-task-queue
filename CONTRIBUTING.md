# 贡献指南

欢迎 issue / PR。这是一个小而专注的框架,改动尽量保持下面几条原则。

## 设计原则(改之前先读)

1. **不自研 todo 层**:数据源、录入、进度一律走飞书任务原生能力。
2. **约定优于配置**:能用命名约定(如清单前缀)自动发现的,就别让用户手填。
3. **opt-in 部署**:不替用户改系统。系统级调度(launchd/cron/systemd)都做成模板,使用者自己装。
4. **只动 `AI` 前缀清单**:绝不碰用户其它飞书任务;不删任务、不改清单结构;重复任务不擅自划掉。
5. **失败不崩**:单条任务失败记日志 + 评论,继续整轮。

## 代码约定

- 脚本用 `bash`(shebang `#!/usr/bin/env bash`),但要兼容从 zsh `source`(用 `${BASH_SOURCE[0]:-$0}`、纯 jq 做字符串处理,别用 zsh/bash 专有展开)。
- 飞书调用统一走 `scripts/lib.sh` 的助手;新 API 先 `lark-cli schema <svc>.<res>.<method>` 看参数,原生透传用 `lark-cli api`。
- 改了行为先更新 `prompts/run-queue.md`(执行口径)与 `NOTES.md`(命令摸底)。
- 提交前:`for s in scripts/*.sh; do bash -n "$s"; done` 过语法,`bash scripts/doctor.sh` 过体检。

## 提 PR

- 一个 PR 聚焦一件事,描述清楚动机与影响面。
- 不要提交任何含真实 `open_id` / 清单 `guid` / 文档链接 / 密钥的文件(已被 `.gitignore` 覆盖,注意别强加)。

## 本地验证(无副作用部分)

```bash
bash scripts/doctor.sh           # 体检
bash scripts/pull-queue.sh       # 看队列(只读)
bash -c 'source scripts/lib.sh; check_confirmation <task_guid>'   # 确认状态机
```
