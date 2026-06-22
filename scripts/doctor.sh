#!/usr/bin/env bash
# doctor.sh — 安装/配置体检。新用户上手或排错时跑一次,逐项告诉你缺什么。
#   bash scripts/doctor.sh

export LARK_CLI_NO_PROXY=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$ROOT"

ok=0; warn=0; bad=0
pass(){ printf "  ✓ %s\n" "$1"; ok=$((ok+1)); }
note(){ printf "  ! %s\n" "$1"; warn=$((warn+1)); }
fail(){ printf "  ✗ %s\n" "$1"; bad=$((bad+1)); }

echo "── 1. 依赖 ──"
for c in lark-cli claude jq curl; do
  if command -v "$c" >/dev/null 2>&1; then pass "$c 已安装"; else fail "$c 缺失"; fi
done

echo "── 2. 飞书认证(lark-cli)──"
auth="$(lark-cli auth status 2>/dev/null)"
if [ -z "$auth" ]; then
  fail "lark-cli auth status 无输出,先 lark-cli config init / auth login"
else
  ustat="$(jq -r '.identities.user.status // "none"' <<<"$auth")"
  [ "$ustat" = "ready" ] && pass "user 身份 ready ($(jq -r '.identities.user.userName // "?"' <<<"$auth"))" \
                          || fail "user 身份未就绪($ustat),跑 lark-cli auth login --scope ..."
  bstat="$(jq -r '.identities.bot.status // "none"' <<<"$auth")"
  [ "$bstat" = "ready" ] && pass "bot 身份 ready(推送用)" || note "bot 身份未就绪($bstat),仅 channel=bot 推送需要"
fi

echo "── 3. 配置 ──"
if [ -f config/config.json ]; then
  pass "config/config.json 存在"
  prefix="$(jq -r '.queue.tasklist_name_prefix // ""' config/config.json)"
  [ -n "$prefix" ] && pass "队列前缀 = \"$prefix\"" || note "未设 tasklist_name_prefix"
  ch="$(jq -r '.notify.channel // "bot"' config/config.json)"
  case "$ch" in
    off) pass "推送 channel=off(不推送)";;
    bot) [ -n "$(jq -r '.notify.user_open_id // ""' config/config.json)" ] \
            && pass "推送 channel=bot,已填 user_open_id" || note "channel=bot 但 user_open_id 为空";;
    webhook) [ -n "$(jq -r '.notify.webhook_url // ""' config/config.json)" ] \
            && pass "推送 channel=webhook,已填 webhook_url" || note "channel=webhook 但 webhook_url 为空";;
    *) note "未知 notify.channel=$ch";;
  esac
else
  fail "config/config.json 不存在 → cp config/config.example.json config/config.json 后填写"
fi

echo "── 4. 队列清单发现 ──"
if [ -f config/config.json ] && command -v jq >/dev/null 2>&1; then
  source scripts/lib.sh 2>/dev/null
  n=0
  while IFS= read -r tl; do
    [ -z "$tl" ] && continue
    printf "  ✓ 命中清单:%s\n" "$(jq -r '.name' <<<"$tl")"; n=$((n+1)); ok=$((ok+1))
  done < <(resolve_tasklists 2>/dev/null)
  [ "$n" -eq 0 ] && note "没发现 \"$prefix\" 前缀的清单 → 去飞书建一个名字以该前缀开头的任务清单"
else
  note "跳过(缺 config 或 jq)"
fi

echo ""
echo "── 体检结果:✓ $ok  ! $warn  ✗ $bad ──"
[ "$bad" -eq 0 ] && echo "可以开跑:bash scripts/cron-run.sh(或 scripts/daemon.sh start)" \
                 || echo "先解决上面 ✗ 项再开跑。"
exit 0
