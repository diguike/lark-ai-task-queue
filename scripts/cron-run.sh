#!/usr/bin/env bash
# cron-run.sh — 兼容转发(v0.2 起核心已改为 Node CLI)。
# 等价于 `larkaq run`。保留它是为了不破坏既有 launchd/cron/systemd 配置。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
exec node "$ROOT/bin/larkaq" run "$@"
