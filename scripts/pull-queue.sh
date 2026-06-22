#!/usr/bin/env bash
# pull-queue.sh — 兼容转发。等价于 `larkaq queue pull`。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
exec node "$ROOT/bin/larkaq" queue pull "$@"
