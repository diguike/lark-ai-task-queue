# DEPLOY — 怎么让它长期跑

`/loop` 跑在交互式会话里,**关会话/睡眠就停**,只适合盯着跑。长期无人值守用下面任一种 **headless** 方式(都复用同一个 `scripts/cron-run.sh`,内部用 `claude -p` 读 `prompts/run-queue.md` 跑一轮)。

> 框架**不会自动改你的系统**。下面每种都是你自己选、自己装;`deploy/` 下是模板。

## 选哪种?

| 方式 | 进系统? | 24h? | 适合 | 一键 |
|---|---|---|---|---|
| **A. daemon.sh**(默认) | ❌ 纯用户态进程 | 机器开着就跑 | 本地常开机器,又不想动系统定时任务 | `scripts/daemon.sh start` |
| **B. launchd**(macOS) | ✅ 用户 LaunchAgent | 登录后自动拉起 | macOS 想开机自启、更稳 | 见下 |
| **C. cron** | ✅ crontab | 睡眠不跑 | Linux,或 Mac 常不睡 | 见下 |
| **D. systemd timer** | ✅ systemd | ✅ 重启自恢复 | Linux 服务器/云 VPS | 见下 |
| **E. Docker** | 容器 | ✅ | 想隔离/上云 | 见下 |

**没主意就用 A**:本地常开、零系统侵入、随时 `stop`。

---

## A. daemon.sh — 用户态常驻(推荐默认)

```bash
scripts/daemon.sh once      # 先手动跑一轮验证
scripts/daemon.sh start     # 后台启动(nohup),间隔取自 config.poll_interval_minutes
scripts/daemon.sh status    # 看是否在跑
scripts/daemon.sh logs      # 跟踪输出
scripts/daemon.sh stop      # 停
```
不写 crontab、不装 LaunchAgent,就是一个你能随时关的后台进程。重启机器后需要再 `start`(想开机自启就叠加 B)。

## B. launchd(macOS,开机自启)—— ✅ 本机已安装

本机已装 `~/Library/LaunchAgents/com.lark-ai-task-queue.plist`(每 1 小时 + 登录自启)。常用操作:
```bash
launchctl list | grep lark-ai-task-queue                                 # 看状态(PID 退出码)
launchctl unload ~/Library/LaunchAgents/com.lark-ai-task-queue.plist     # 临时停
launchctl load   ~/Library/LaunchAgents/com.lark-ai-task-queue.plist     # 重新启
rm ~/Library/LaunchAgents/com.lark-ai-task-queue.plist                   # 彻底卸载(先 unload)
tail -f logs/launchd.out                                             # 看输出
```
> ⚠️ 关键坑:launchd 环境 PATH 很干净,plist 里**必须**把 `claude`/`lark-cli` 所在目录(本机是 nvm 的
> `…/v20.19.1/bin`)写进 `PATH`,并设 `HOME`,否则找不到命令。本机 plist 已配好。

开源用户从模板装:
```bash
ROOT="$(pwd)"; NODE_BIN="$(dirname "$(command -v claude)")"
sed -e "s#__ROOT__#$ROOT#g" deploy/launchd/com.lark-ai-task-queue.plist.template \
  > ~/Library/LaunchAgents/com.lark-ai-task-queue.plist
# 再手动把 $NODE_BIN 加进 plist 的 PATH(模板里有注释位置)
launchctl load ~/Library/LaunchAgents/com.lark-ai-task-queue.plist
```
`StartInterval`(秒)改成与 `poll_interval_minutes` 一致。想防睡眠可 `caffeinate -s` 配合。

## C. cron

```bash
crontab -e        # 粘贴 deploy/crontab.example,把 __ROOT__ 换成绝对路径
```
⚠️ macOS 睡眠时 cron 不触发。

## D. systemd timer(Linux 服务器 / 云 VPS)

```bash
ROOT="$(pwd)"; mkdir -p ~/.config/systemd/user
for f in lark-ai-task-queue.service lark-ai-task-queue.timer; do
  sed "s#__ROOT__#$ROOT#g" deploy/systemd/$f > ~/.config/systemd/user/$f
done
systemctl --user daemon-reload
systemctl --user enable --now lark-ai-task-queue.timer
```

## E. Docker(可选,隔离/上云)

容器里需要装好 `lark-cli`、`claude`、`jq`,并注入两套登录态(见下)。骨架:
```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y jq && npm i -g lark-cli @anthropic-ai/claude-code
WORKDIR /app
COPY . .
CMD ["bash","scripts/daemon.sh","run"]
```

---

## 两套认证(任何方式都要)

headless 进程需要两个登录态都有效:

1. **lark-cli**(飞书):`lark-cli auth status` 应为 ready。用户身份 token 会**滑动续期**——只要 runner 至少每隔几天跑一次,就自动刷新、无需你管;连续停跑超 ~7 天才需重新 `lark-cli auth login`。
2. **claude**(执行器):`cron-run.sh` 用 `claude -p --dangerously-skip-permissions`。本地已登录即可;云端需配 `ANTHROPIC_API_KEY` 或 `claude setup-token`。

> `--dangerously-skip-permissions` 是 headless 无人值守必须的(没有人在场点确认)。安全靠 `run-queue.md` 的闸门:高风险任务(删除/外发/花钱)只评论"需人工确认"、不执行。

## 防重叠执行(重要)

`cron-run.sh` 自带**单实例锁**(`logs/cron-run.lock`):若上一轮任务跑得比轮询间隔还久,下一次触发会检测到锁、**直接跳过本轮**,不会重复处理同一任务(普通任务在处理完才标记完成,没有锁时重叠会导致双跑)。锁在进程退出时自动释放;持有者已死的陈旧锁会被下一轮接管。daemon.sh 本身串行、launchd 单例,cron 靠这把锁兜底。

## 间隔同步(重要)

`config.poll_interval_minutes` 只驱动 `daemon.sh` 的循环间隔;**launchd 的 `StartInterval` / cron 表达式 / systemd 的 `OnUnitActiveSec` 是各调度器独立的静态值,改了 config 要手动同步**。本机 launchd 当前 = 3600s(1 小时),与 config 一致。改间隔:编辑 plist 的 `StartInterval` 后 `launchctl unload && load`。

## 安全 & 排错

- 看日志:`logs/YYYY-MM-DD.log`(每条任务一行)、`logs/daemon.out` / `logs/cron.log` / `logs/launchd.*`。
- 临时停:`scripts/daemon.sh stop`,或卸载对应的 launchd/cron/timer。
- 队列隔离:只处理名字以 `AI` 前缀(可配)的清单,不碰你其它飞书任务。
