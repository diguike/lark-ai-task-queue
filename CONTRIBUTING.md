# 贡献指南

欢迎 issue / PR。这是一个小而专注的框架,改动尽量保持下面几条原则。

## 设计原则(改之前先读)

1. **不自研 todo 层**:数据源、录入、进度一律走飞书任务原生能力。
2. **约定优于配置**:能用命名约定(如清单前缀)自动发现的,就别让用户手填。
3. **极简依赖**:核心只要 `lark-cli` + `claude`;工具本身保持**纯 Node、零三方 npm 依赖**。需要 JSON/HTTP 用 Node 内置能力,别引入 jq/curl/axios 之类。
4. **opt-in 部署**:不替用户改系统。系统级调度(launchd/cron/systemd)都做成模板,使用者自己装。
5. **只动 `AI` 前缀清单**:绝不碰用户其它飞书任务;不删任务、不改清单结构;重复任务不擅自划掉。
6. **失败不崩**:单条任务失败记日志 + 评论,继续整轮。

## 代码约定

- 全量 ES Module(`.mjs`),Node ≥ 18。
- **纯逻辑与 I/O 分离**:状态机、过滤、计数等放 `src/core/` 的纯函数(便于单测);spawn `lark-cli` 只在 `src/core/lark.mjs`。
- 新增飞书调用统一走 `src/core/lark.mjs`;新 API 先 `lark-cli schema <svc>.<res>.<method>` 看参数结构,原生未封装的用 `lark-cli api GET/POST` 透传。
- 改了执行口径(AI 执行器的行为)先同步 `prompts/run-queue.md`。
- 给纯逻辑补单测;改了行为先让 `node --test` 全绿。

## 提 PR

- 一个 PR 聚焦一件事,描述清楚动机与影响面。
- 不要提交任何含真实 `open_id` / 清单 `guid` / 文档链接 / 密钥的文件(已被 `.gitignore` 覆盖,注意别强加)。

## 本地验证(无副作用部分)

```bash
node --test                # 跑单测(零依赖,纯逻辑全覆盖)
node bin/larkaq --help           # 命令一览
node bin/larkaq config list      # 看配置(脱敏)
node bin/larkaq run --dry-run    # 看队列 + 预筛(不唤起 claude)
```
