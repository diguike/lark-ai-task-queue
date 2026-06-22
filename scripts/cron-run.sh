#!/usr/bin/env bash
# cron-run.sh — headless 跑一轮(脱离交互式 Claude Code)。供 launchd/cron/systemd/daemon.sh 调用。
# 流程:纯 shell 预筛(省 token)→ 有活才唤起 claude -p 读 run-queue.md 端到端执行。
#
# launchd/cron/systemd 模板见 deploy/ 与 DEPLOY.md。

set -euo pipefail
export LARK_CLI_NO_PROXY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib.sh"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron-run 开始"

# 单实例锁:上一轮还没跑完(长任务超过轮询间隔)就直接跳过本轮,避免重复处理同一任务
if ! acquire_lock; then
  log_line "previous round still running (pid $(cat "$LOCK_DIR/pid" 2>/dev/null)), skip this tick"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 上一轮仍在运行,跳过本轮"
  exit 0
fi

# 预筛:没有可处理任务就别唤起 Claude(队列空 / 都在等确认 / 重复任务今天已干)
N="$(count_actionable || echo 0)"
if [ "${N:-0}" -eq 0 ]; then
  log_line "no actionable tasks this round (skip claude)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 无可处理任务,跳过 claude"
  exit 0
fi
echo "可处理任务数: $N,唤起 claude…"

PROMPT="$(cat "$ROOT/prompts/run-queue.md")
项目根目录: $ROOT。按上面步骤跑一轮:source scripts/lib.sh,用 bash scripts/pull-queue.sh 拉队列,逐条处理(含异步确认/重复任务判型),回写飞书,写 logs/,最后用 notify 发飞书汇总。"

# --dangerously-skip-permissions: headless 无人值守必须(没人点确认)。
# 安全靠 run-queue.md 闸门:高风险任务只评论 [AI-NEEDS-CONFIRM] 不执行。
claude -p "$PROMPT" --add-dir "$ROOT" --dangerously-skip-permissions

echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron-run 结束"
