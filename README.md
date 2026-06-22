# Lark AI Task Queue

> 把**飞书任务清单**当成"寄给 AI 的待办队列"——你在专属清单里记一条任务,AI 定时拉取、自动执行,产出飞书文档,完成后回写评论并标记完成。
>
> *Turn a Feishu/Lark task list into an async work queue for an AI agent: it polls unfinished tasks on a schedule, does the work, ships a Lark Doc, and writes the result back to the task.*

**核心理念**:复用成熟的 todo 工具(飞书任务)当数据源和界面,AI 只负责"定时拉取 + 执行 + 回写",不自研 todo 层。

---

## ✨ 特性

- **零自研 todo**:数据源、录入、进度都用飞书任务原生界面,手机/网页都能记。
- **约定优于配置**:清单名以 `AI` 前缀开头即被自动当作队列,无需手填 guid;`name→guid` 自动缓存。
- **隔离安全**:只动 `AI` 前缀清单,绝不碰你其它私人任务。
- **异步人工确认**:任务卡在需拍板处时评论提问并挂起,你**有空回复**后下一轮自动续作。
- **每日/重复任务**:带 `[每日]` 标记的任务做完只追评论、不划掉,每天最多跑一次。
- **每轮飞书推送**:跑完私聊你一条小结(完成/等确认/失败 + 文档链接),渠道可选 `off`/`bot`/`webhook`。
- **无人值守**:`/loop`、用户态 `daemon.sh`、launchd / cron / systemd / docker,任选;单实例锁防重叠、空转不烧 token。
- **一个应用一次登录**:核心只用 user 身份,开源使用者上手成本极低。

## 🚀 快速开始

### 0. 前置依赖
`lark-cli`、`claude`(Claude Code)、`jq`、`curl`、`bash`。装好后:
```bash
bash scripts/doctor.sh     # 一键体检:依赖 / 认证 / 配置 / 清单发现,逐项告诉你缺什么
```

### 1. 飞书应用 + 登录(一次性)
注册一个飞书应用给 lark-cli 用,开通 scope:`task:*`、`im:message`、`docx:document:create`、`docs:*`,然后:
```bash
lark-cli config init                 # 填 appId / appSecret(如未配过)
lark-cli auth login --scope "task:task:write task:tasklist:read task:comment:write docx:document:create"
```
> 详见 [DEPLOY.md → 两套认证](DEPLOY.md)。只需一次 user 登录;bot 身份由同一应用自动附带。

### 2. 建队列清单
在飞书新建一个任务清单,**名字以 `AI` 开头**(如 `AI 队列`)。就这样,框架会自动发现它。

### 3. 配置
```bash
cp config/config.example.json config/config.json
# 按需改:max_tasks_per_run、poll_interval_minutes、notify.channel 等(见下「配置说明」)
```

### 4. 跑一轮验证
往清单里加一条任务(如「调研 X 写一页总结」),然后:
```bash
bash scripts/pull-queue.sh           # 看拉到了什么
bash scripts/cron-run.sh             # headless 跑一轮(拉取→执行→建文档→回写→完成→日志→推送)
```
或在 Claude Code 里发:`按 prompts/run-queue.md 跑一轮飞书 AI 任务队列`。

### 5. 接上定时
长期无人值守见 **[DEPLOY.md](DEPLOY.md)**。最省心:
```bash
scripts/daemon.sh start              # 用户态后台常驻,不进系统定时任务;stop 可停
```

## ⚙️ 配置说明(`config/config.json`)

| 段 | 关键字段 | 说明 |
|---|---|---|
| `queue` | `tasklist_name_prefix` | 清单名前缀(默认 `AI`),命中即入队 |
| | `tasklist_guids` | 可选白名单;非空时只认这些 guid,忽略前缀 |
| `execution` | `max_tasks_per_run` | 每轮最多处理几条 |
| | `poll_interval_minutes` | `daemon.sh` 轮询间隔(launchd/cron 需各自同步) |
| | `require_confirmation_for_risky` | 高风险任务(删除/外发/花钱)是否挂起等确认 |
| `confirmation` | `needs_confirm_marker` / `ai_sentinel` | 异步确认的标记与哨兵(`🤖`),用于区分人机评论 |
| `recurring` | `markers` | 命中则做完只追评论、不划掉(每日最多一次) |
| `output` | `create_lark_doc` / `doc_folder_token` | 是否建飞书文档、落哪个文件夹 |
| | `mark_task_done_on_success` | 成功后是否标记完成(重复任务除外) |
| `notify` | `channel` | `off` / `bot`(填 `user_open_id`) / `webhook`(填 `webhook_url`) |

## 🧠 进阶能力

| 能力 | 行为 |
|---|---|
| **异步人工确认** | 需拍板时 AI 评论 `🤖 [AI-NEEDS-CONFIRM] …` 并留在队列;你回复后下一轮读取回复续作。靠 `🤖` 哨兵区分人机。 |
| **重复/每日任务** | 标题/描述含 `[每日]`/`[daily]` 等(或飞书重复规则)→ 做完只追评论、不完成;每自然日最多一次。 |
| **每轮推送** | 跑完发飞书汇总;`channel` 可选 `off`/`bot`/`webhook`。 |
| **防重叠** | `cron-run.sh` 单实例锁:上一轮没跑完,下一轮自动跳过,不重复处理。 |
| **省 token 预筛** | 纯 shell 先判断有无真要干的活,无活不唤起 Claude。 |

## 🔁 工作流

```
飞书 "AI…" 清单加任务
   │   定时触发(daemon/launchd/cron/loop)
   ▼
pull-queue.sh 拉未完成任务(前缀发现 + 缓存)
   │   逐条:查确认状态 → 判型(普通/重复/高风险)
   ▼
执行(调研/写作/分析) → lark-doc 建飞书文档
   │
   ▼
回写:文档链接评论回任务 →(普通)标记完成 /(重复)只追评论
   │
   ▼
写 logs/YYYY-MM-DD.log → notify 发飞书小结
```

## 📁 目录结构

```
lark-ai-task-queue/
├── README.md / DEPLOY.md / NOTES.md / CONTRIBUTING.md / LICENSE
├── config/
│   ├── config.example.json     # 配置模板(提交)
│   ├── config.json             # 你的实例配置(gitignore)
│   └── state.json              # name→guid 缓存(gitignore)
├── prompts/
│   ├── run-queue.md            # 运行时核心提示词(每轮执行逻辑)
│   └── IMPLEMENTATION.md       # 一次性启动提示词
├── scripts/
│   ├── lib.sh                  # 确定性管道助手(被 source)
│   ├── pull-queue.sh           # 发现+拉取未完成任务 → JSON
│   ├── cron-run.sh             # headless 跑一轮(锁+预筛+claude -p)
│   ├── daemon.sh               # 用户态常驻调度器(start/stop/status)
│   └── doctor.sh               # 安装/配置体检
├── deploy/                     # launchd / systemd / cron 模板(opt-in)
├── logs/                       # 执行日志(gitignore)
└── docs/                       # 本地留档(gitignore)
```

## 🔒 安全

- **只动 `AI` 前缀清单**,不碰你其它飞书任务;不删任务、不改清单结构;重复任务永不擅自划掉。
- **高风险闸门**:删除/外发/花钱类任务默认挂起等你确认,不自动执行。
- **headless 必须 `--dangerously-skip-permissions`**(无人值守没人点确认),安全靠上面的闸门兜底。
- **不提交密钥/个人数据**:`config.json`、`state.json`、`logs/` 已被 `.gitignore` 排除;appSecret 存于 `~/.lark-cli`,不在仓库。

## ❓ FAQ

**Q: 开源给别人要授权两套账号、还得建机器人吗?**
不用。整个 lark-cli 只配**一个飞书应用**,它同时给出 `user`(需一次 `auth login`)和 `bot`(自动)两种令牌。核心功能只用 user;"建机器人"就是"注册那一个应用"。推送想零配置就用 `webhook` 渠道。

**Q: 每小时一次,上一轮没跑完会重复执行吗?**
不会。`cron-run.sh` 有单实例锁,上一轮在跑就跳过本轮。

**Q: 改了 `poll_interval_minutes` 为什么 launchd 没变?**
launchd/cron/systemd 的间隔是各自独立的静态值,需手动同步;只有 `daemon.sh` 读 config。见 [DEPLOY.md](DEPLOY.md)。

## 🗺️ Roadmap

- [ ] 任务优先级 / 依赖(`priority` / `depends_on`)
- [ ] 用量限制感知(接近配额自动暂停)
- [ ] 失败重试与加急告警
- [ ] 多队列 / 多用户协作
- [x] 异步人工确认往返
- [x] 重复(每日)任务
- [x] 每轮飞书推送(off/bot/webhook)
- [x] 无人值守部署 + 防重叠锁 + 省 token 预筛

## 📄 License

[MIT](LICENSE)
