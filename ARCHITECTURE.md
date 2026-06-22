# 架构 / Architecture

> 纯 Node.js CLI,零三方依赖。核心原则:**纯逻辑与 I/O 分离** —— 状态机、过滤、时区计算
> 都是纯函数(`src/core` 里,可直接单测);唯一 spawn `lark-cli` 的地方收敛在 `core/lark.mjs`。

## 模块依赖

```mermaid
flowchart TD
    bin["bin/larkaq"] --> cli["src/cli.mjs<br/>命令分发"]
    cli --> cmds["src/commands/*<br/>install · doctor · config<br/>run · daemon · agent"]
    cmds --> core["src/core/*"]

    subgraph core["src/core(业务核心)"]
        config["config.mjs<br/>配置与路径"]
        lark["lark.mjs<br/>⚠️ 唯一 spawn lark-cli"]
        queue["queue.mjs<br/>发现/拉取/预筛"]
        confirm["confirm.mjs<br/>确认状态机 + 重复判定"]
        notify["notify.mjs<br/>off/bot/webhook"]
        lock["lock.mjs<br/>单实例锁"]
        logger["logger.mjs<br/>按天日志"]
    end

    queue --> lark
    queue --> confirm
    confirm --> lark
    notify --> lark
    core --> util["src/util.mjs<br/>纯工具(dig/localDate/which/原子写)"]
```

纯函数(无 I/O,被 `test/` 直接覆盖):`util.dig/setDeep/localDate/nowStamp/which`、
`confirm.evaluateConfirmation/recurringDoneOn/isRecurringText/isActionable/normalizeComments`、
`queue.filterTasklists/projectTask/selectActionable`、`config.validateConfig`、
`lark.collectPaged`、`notify.webhookTextPayload`。

## 一轮执行的数据流

```mermaid
flowchart TD
    start(["larkaq run"]) --> lock{"取单实例锁?"}
    lock -- 否 --> skip1["上一轮仍在跑 → 跳过本轮"]
    lock -- 是 --> pre["countActionable():<br/>发现 AI 清单 → 拉未完成任务<br/>→ 逐条按可执行性过滤 → 截断 max"]
    pre -- "= 0" --> skip2["无可处理任务 → 不唤起 claude"]
    pre -- "> 0" --> claude["claude -p 读 run-queue.md<br/>逐条执行"]
    claude --> doc["建飞书文档"]
    claude --> writeback["回写评论 +(普通)标记完成 /(重复)只追评论"]
    claude --> log["写 logs/ + larkaq notify 飞书小结"]
```

## 异步人工确认状态机

`confirm.evaluateConfirmation(comments, marker, sentinel)` —— 靠哨兵 `🤖` 区分人机评论。

```mermaid
stateDiagram-v2
    [*] --> none: 无确认请求
    none --> waiting: AI 评论<br/>🤖 [AI-NEEDS-CONFIRM] …
    waiting --> waiting: 仍无人回复<br/>(或只有 AI 自己的评论)
    waiting --> confirmed: 确认请求之后<br/>出现非哨兵开头的新评论(你的回复)
    confirmed --> [*]: 带着 reply 继续推进该任务
    none --> [*]: 全新任务,正常执行
```

- **确认请求**必须是 AI 评论(`startsWith(🤖)` 且 `includes([AI-NEEDS-CONFIRM])`),
  所以你回复里引用该标记不会被误判为新的确认请求。
- **重复任务**的"今天已干过"只认含成功标记(`✅`)的 AI 评论,失败评论(`🤖 ❌`)不阻断当日重试。

## 调度形态

`larkaq run` 是所有 headless 方式的统一入口(单实例锁防重叠):

```mermaid
flowchart LR
    daemon["larkaq start<br/>(用户态常驻)"] --> run["larkaq run"]
    launchd["launchd (macOS)"] --> run
    cron["cron"] --> run
    systemd["systemd timer (Linux)"] --> run
    loop["/loop (交互式)"] --> run
```

详见 [DEPLOY.md](DEPLOY.md)。
