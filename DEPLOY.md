# DEPLOY — 怎么让它长期跑

`/loop` 跑在交互式会话里,**关会话/睡眠就停**,只适合盯着跑。长期无人值守用下面任一种 **headless** 方式(都跑同一条命令 `larkaq run`,内部用 `claude -p` 读 `prompts/run-queue.md` 跑一轮)。

> 框架**不会自动改你的系统**。下面每种都是你自己选、自己装;`deploy/` 下是模板。
> 模板里两个占位符:`__ROOT__`=项目绝对路径,`__NODE_BIN__`=`dirname "$(command -v node)"`(node/lark-cli/claude 所在目录)。

## 选哪种?

| 方式 | 进系统? | 24h? | 适合 | 一键 |
|---|---|---|---|---|
| **A. larkaq start**(默认) | ❌ 纯用户态进程 | 机器开着就跑 | 本地常开机器,又不想动系统定时任务 | `larkaq start` |
| **B. launchd**(macOS) | ✅ 用户 LaunchAgent | 登录后自动拉起 | macOS 想开机自启、更稳 | 见下 |
| **C. cron** | ✅ crontab | 睡眠不跑 | Linux,或 Mac 常不睡 | 见下 |
| **D. systemd timer** | ✅ systemd | ✅ 重启自恢复 | Linux 服务器/云 VPS | 见下 |
| **E. Docker** | 容器 | ✅ | 想隔离/上云 | 见下 |

**没主意就用 A**:本地常开、零系统侵入、随时 `stop`。

---

## A. larkaq start — 用户态常驻(推荐默认)

```bash
larkaq run            # 先手动跑一轮验证
larkaq start          # 后台启动,间隔取自 config.poll_interval_minutes
larkaq status         # 看是否在跑
larkaq logs           # 跟踪输出
larkaq stop           # 停
```
不写 crontab、不装 LaunchAgent,就是一个你能随时关的后台 node 进程。重启机器后需要再 `start`(想开机自启就叠加 B)。

## B. launchd(macOS,开机自启)

从模板装(自动填好 `__ROOT__` 与 `__NODE_BIN__`):
```bash
ROOT="$(pwd)"; NODE_BIN="$(dirname "$(command -v node)")"
sed -e "s#__ROOT__#$ROOT#g" -e "s#__NODE_BIN__#$NODE_BIN#g" -e "s#__HOME__#$HOME#g" \
  deploy/launchd/com.lark-ai-task-queue.plist.template \
  > ~/Library/LaunchAgents/com.lark-ai-task-queue.plist
launchctl load ~/Library/LaunchAgents/com.lark-ai-task-queue.plist
```
常用操作:
```bash
launchctl list | grep lark-ai-task-queue                                 # 看状态(PID 退出码)
launchctl unload ~/Library/LaunchAgents/com.lark-ai-task-queue.plist     # 临时停
launchctl load   ~/Library/LaunchAgents/com.lark-ai-task-queue.plist     # 重新启
tail -f logs/launchd.out                                                 # 看输出
```
> ⚠️ 关键坑:launchd 环境 PATH 很干净,plist 里**必须**把 `node`/`lark-cli`/`claude` 所在目录(nvm 用户通常是 `~/.nvm/versions/node/<ver>/bin`)写进 `PATH` 并设 `HOME`,否则找不到命令。上面的 sed 已自动填好。

`StartInterval`(秒)改成与 `poll_interval_minutes` 一致。想防睡眠可 `caffeinate -s` 配合。

## C. cron

```bash
ROOT="$(pwd)"; NODE_BIN="$(dirname "$(command -v node)")"
sed -e "s#__ROOT__#$ROOT#g" -e "s#__NODE_BIN__#$NODE_BIN#g" -e "s#__HOME__#$HOME#g" \
  deploy/crontab.example
# 把输出粘到 `crontab -e`
```
⚠️ macOS 睡眠时 cron 不触发。

## D. systemd timer(Linux 服务器 / 云 VPS)

```bash
ROOT="$(pwd)"; NODE_BIN="$(dirname "$(command -v node)")"
mkdir -p ~/.config/systemd/user
for f in lark-ai-task-queue.service lark-ai-task-queue.timer; do
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__NODE_BIN__#$NODE_BIN#g" deploy/systemd/$f \
    > ~/.config/systemd/user/$f
done
systemctl --user daemon-reload
systemctl --user enable --now lark-ai-task-queue.timer
```

## E. Docker(可选,隔离/上云)

容器里装好 `lark-cli`、`claude`(node 基镜像自带),注入两套登录态(见下)。骨架:
```dockerfile
FROM node:20-slim
RUN npm i -g lark-cli @anthropic-ai/claude-code
WORKDIR /app
COPY . .
CMD ["node","bin/larkaq","_daemon-loop"]
```
> 不再需要 `jq` —— JSON 解析全在 Node 内。

---

## 两套认证(任何方式都要)

headless 进程需要两个登录态都有效:

1. **lark-cli**(飞书):`lark-cli auth status` 应为 ready。用户身份 token 会**滑动续期**——只要 runner 至少每隔几天跑一次,就自动刷新、无需你管;连续停跑超 ~7 天才需重新 `lark-cli auth login`。
2. **claude**(执行器):`larkaq run` 用 `claude -p --dangerously-skip-permissions`。本地已登录即可;云端需配 `ANTHROPIC_API_KEY` 或 `claude setup-token`。

> `--dangerously-skip-permissions` 是 headless 无人值守必须的(没有人在场点确认)。安全靠 `run-queue.md` 的闸门:高风险任务(删除/外发/花钱)只评论"需人工确认"、不执行。

## 防重叠执行(重要)

`larkaq run` 自带**单实例锁**(`logs/cron-run.lock`):若上一轮任务跑得比轮询间隔还久,下一次触发会检测到锁、**直接跳过本轮**,不会重复处理同一任务(普通任务在处理完才标记完成,没有锁时重叠会导致双跑)。锁在进程退出时自动释放;持有者已死的陈旧锁会被下一轮接管(并校验 root 一致,避免 PID 复用误判)。

## 间隔同步(重要)

`config.poll_interval_minutes` 只驱动 `larkaq start` 的循环间隔;**launchd 的 `StartInterval` / cron 表达式 / systemd 的 `OnUnitActiveSec` 是各调度器独立的静态值,改了 config 要手动同步**。

## 旧版兼容

`scripts/cron-run.sh` / `daemon.sh` / `doctor.sh` / `pull-queue.sh` 仍保留,但已变成 `→ node bin/larkaq …` 的薄转发。旧的 launchd/cron 配置不会断;有空把模板换成直接调 `bin/larkaq` 即可。

## 安全 & 排错

- 看日志:`logs/YYYY-MM-DD.log`(每条任务一行)、`logs/daemon.out` / `logs/cron.log` / `logs/launchd.*`。
- 临时停:`larkaq stop`,或卸载对应的 launchd/cron/timer。
- 排查:`larkaq doctor`(逐项体检)、`LARKAQ_DEBUG=1 larkaq run`(打印堆栈)。
- 队列隔离:只处理名字以 `AI` 前缀(可配)的清单,不碰你其它飞书任务。
