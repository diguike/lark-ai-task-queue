#!/usr/bin/env bash
# daemon.sh — 用户态常驻调度器(不碰系统 cron/launchd)。
# 你自己 start/stop,纯前台/后台进程,随时可关。这是"本地常开但不进系统定时任务"的默认方式。
#
# 用法:
#   scripts/daemon.sh once      跑一轮(测试用,前台,跑完即退)
#   scripts/daemon.sh run       前台循环(Ctrl-C 停)
#   scripts/daemon.sh start     后台启动循环(nohup,写 pid)
#   scripts/daemon.sh stop      停止后台循环
#   scripts/daemon.sh status    查看运行状态
#   scripts/daemon.sh logs      跟踪 stdout 输出
#
# 间隔取自 config.json 的 execution.poll_interval_minutes(默认 30)。

set -euo pipefail
export LARK_CLI_NO_PROXY=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

CONFIG="$ROOT/config/config.json"; [ -f "$CONFIG" ] || CONFIG="$ROOT/config/config.example.json"
PIDFILE="$ROOT/logs/daemon.pid"
OUTLOG="$ROOT/logs/daemon.out"
mkdir -p "$ROOT/logs"

interval_sec() {
  local m; m="$(jq -r '.execution.poll_interval_minutes // 30' "$CONFIG")"
  echo $(( m * 60 ))
}

one_round() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ── round start ──"
  bash "$ROOT/scripts/cron-run.sh" || echo "[warn] 本轮 cron-run 返回非 0,继续下一轮"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ── round end ──"
}

is_running() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

cmd="${1:-status}"
case "$cmd" in
  once)
    one_round
    ;;
  run)
    local_sec="$(interval_sec)"
    echo "前台循环启动,间隔 ${local_sec}s。Ctrl-C 停止。"
    while true; do one_round; echo "sleep ${local_sec}s…"; sleep "$local_sec"; done
    ;;
  start)
    if is_running; then echo "已在运行 (pid $(cat "$PIDFILE"))"; exit 0; fi
    nohup "$0" run >>"$OUTLOG" 2>&1 &
    echo $! >"$PIDFILE"
    echo "已后台启动 (pid $(cat "$PIDFILE"))。输出: $OUTLOG"
    echo "停止: scripts/daemon.sh stop   查看: scripts/daemon.sh logs"
    ;;
  stop)
    if is_running; then
      pid="$(cat "$PIDFILE")"; kill "$pid" 2>/dev/null || true
      rm -f "$PIDFILE"; echo "已停止 (pid $pid)"
    else
      echo "未在运行"; rm -f "$PIDFILE" 2>/dev/null || true
    fi
    ;;
  status)
    if is_running; then echo "运行中 (pid $(cat "$PIDFILE"))，间隔 $(( $(interval_sec) / 60 )) 分钟"
    else echo "未运行"; fi
    ;;
  logs)
    tail -f "$OUTLOG"
    ;;
  *)
    echo "用法: scripts/daemon.sh {once|run|start|stop|status|logs}"; exit 1;;
esac
