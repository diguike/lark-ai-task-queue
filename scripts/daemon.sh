#!/usr/bin/env bash
# daemon.sh — 兼容转发。等价于 `larkaq {start|stop|status|logs|run}`。
# 旧子命令映射:once → run(跑一轮);run(前台循环)→ _daemon-loop。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cmd="${1:-status}"; shift || true
case "$cmd" in
  once) exec node "$ROOT/bin/larkaq" run "$@" ;;
  run)  exec node "$ROOT/bin/larkaq" _daemon-loop "$@" ;;
  *)    exec node "$ROOT/bin/larkaq" "$cmd" "$@" ;;
esac
