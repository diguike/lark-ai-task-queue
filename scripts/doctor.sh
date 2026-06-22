#!/usr/bin/env bash
# doctor.sh — 兼容转发。等价于 `larkaq doctor`。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
exec node "$ROOT/bin/larkaq" doctor "$@"
