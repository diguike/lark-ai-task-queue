# NOTES — 飞书 API 摸底（lark-cli）

> 第 1 步产物：实现"飞书任务清单 = AI 待办队列"闭环所需的全部命令。
> 工具：`lark-cli`（已安装 v1.0.51，有新版 1.0.56 可 `lark-cli update`）。
> 身份：`--as user`（当前登录用户，`open_id` 用 `lark-cli auth status` 查 `openId` 字段）。
> 权限：已具备 `task:task:*`、`task:tasklist:*`、`task:comment:*`、`docx:document:create`、`docs:*` 等全部所需 scope。

## 通用约定
- 所有命令默认 `--json` 输出；原生 API 调用前先 `lark-cli schema <service>.<resource>.<method>` 查参数结构。
- 写操作（建清单 / 评论 / 完成）标记为 Write Operation；高风险（`exit 10` + `confirmation_required`）需追加 `--yes`，本框架不自动加。
- 路径参数只接受 cwd 下相对路径。

## 1. 任务清单（tasklist）

### 创建清单 → 拿 guid
```bash
lark-cli task +tasklist-create --name "AI 队列" --as user --json
# 返回 data.tasklist.guid，写入 config/config.json 的 queue.tasklist_guid
```

### 查清单列表（找已有清单的 guid）
```bash
lark-cli task tasklists list --as user --json
# 或按名搜索：lark-cli task +tasklist-search --query "AI 队列" --as user --json
```

### 列出清单下「未完成」任务（队列拉取核心）
```bash
lark-cli task tasklists tasks --as user --json \
  --params '{"tasklist_guid":"<GUID>","completed":false,"page_size":50}'
# completed=false → 只返回未完成；不填=全部；true=已完成
# 返回 items[]，每项含 guid / summary。详情再用 tasks.get 拉。
# 排序：按需在本地按 created_at 从旧到新取前 max_tasks_per_run 条。
```

### 任务详情（读标题 + 描述）
```bash
lark-cli task tasks get --as user --json --params '{"task_guid":"<GUID>"}'
# 返回 task.summary（标题）、task.description（描述，≤3000 UTF-8 字符）、task.completed_at、task.url
```

## 2. 任务读写

### 加评论（回写文档链接）
```bash
lark-cli task +comment --task-id "<TASK_GUID>" --content "✅ 已完成，产出文档：<URL>" --as user --json
# task-id 必须是 GUID，不是 t104121 这类展示编号
```

### 标记完成
```bash
lark-cli task +complete --task-id "<TASK_GUID>" --as user --json
```

### 重新打开（误标完成时）
```bash
lark-cli task +reopen --task-id "<TASK_GUID>" --as user --json
```

## 3. 飞书文档（lark-doc）

### 建文档 → 拿分享链接
```bash
lark-cli docs +create --api-version v2 --as user --json \
  --content '<title>任务标题</title><h1>小节</h1><p>正文…</p>'
# 返回 data.document.url（形如 https://xxx.feishu.cn/docx/doxcn... ），即分享链接
# 可选 --parent-token <folder_token> 落到指定云空间文件夹（config.output.doc_folder_token）
# 内容默认 XML（支持 callout/checkbox/grid）；--doc-format markdown 走 MD
```

## 4. 读任务评论（异步确认往返用）

CLI 未封装,用原生 API 透传。**参数必须用 `--params` 传 JSON,不能拼在 URL query 里**(拼 URL 会 `field validation failed`)。
```bash
lark-cli api GET "/open-apis/task/v2/comments" \
  --params '{"resource_type":"task","resource_id":"<TASK_GUID>","page_size":100}' --as user
# 返回 data.items[]:{id, content, created_at(ms), creator:{id,type}}
```
> 坑:runner 评论用 `--as user` 写,创建者 id 与人工回复相同,无法靠 id 区分人机。
> 方案:AI 评论统一以哨兵 `🤖` 开头;"你回复了" = 确认评论之后出现不以 `🤖` 开头的新评论。
> 封装在 `lib.sh` 的 `list_comments` / `check_confirmation`(none|waiting|confirmed)。

## 5. 发飞书消息推送（每轮小结）

```bash
lark-cli im +messages-send --as bot --user-id "<我的 open_id>" --markdown "**标题**" --json
# 返回 data.message_id。--as bot = 以应用身份私聊你(已验证可达)。
# 你的 open_id: 用 `lark-cli auth status` 查 openId 字段填入 config.notify.user_open_id
```
封装在 `lib.sh` 的 `notify`。

## 端到端闭环（一条任务）
1. `tasklists tasks --completed false` 拉未完成 → 取前 N 条
2. `tasks get` 读标题+描述 → 理解
3. 执行（调研/写作/分析）
4. `docs +create` 建飞书文档 → 拿 url
5. `task +comment` 把 url 回写为评论
6. `task +complete` 标记完成
7. 追加一行 `logs/YYYY-MM-DD.log`

## 风险闸门
- 高风险任务（删除/外发/花钱）：`config.execution.require_confirmation_for_risky=true` 时不执行，仅 `+comment` 说明"需人工确认"并跳过，不标完成。
- 单条失败：记日志 + 在任务下 `+comment` 错误摘要，继续下一条，不中断整轮。
</content>
</invoke>
