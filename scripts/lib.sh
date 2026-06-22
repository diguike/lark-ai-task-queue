#!/usr/bin/env bash
# lib.sh — Lark AI Task Queue 的确定性管道助手(被其它脚本 source)。
# 负责飞书 lark-cli 的拉取/回写/日志，以及"按前缀自动发现 AI 队列"。
# AI 智能(理解任务、写文档内容)不在这里，由 Claude 按 prompts/run-queue.md 完成。

set -euo pipefail

# 避免凭证经本地代理外传 + 消除 proxy WARN
export LARK_CLI_NO_PROXY=1

# 项目根目录(scripts 的上一级)。跨 bash/zsh:bash 用 BASH_SOURCE,zsh 用 $0;
# 也可用 RUNNER_ROOT 环境变量显式指定。
if [ -n "${RUNNER_ROOT:-}" ]; then
  ROOT="$RUNNER_ROOT"
else
  _self="${BASH_SOURCE[0]:-$0}"
  ROOT="$(cd "$(dirname "$_self")/.." && pwd)"
fi
CONFIG="$ROOT/config/config.json"
[ -f "$CONFIG" ] || CONFIG="$ROOT/config/config.example.json"

LARK() { lark-cli "$@" --as user --json; }
API_GET() { lark-cli api GET "$1" --params "$2" --as user; }

# 单实例锁(防重叠执行 → 防重复处理)。用原子 mkdir,跨 bash/zsh、不依赖 flock。
LOCK_DIR="$ROOT/logs/cron-run.lock"
# acquire_lock — 0=拿到锁(并注册退出时自动释放);1=已有别的轮在跑
acquire_lock() {
  mkdir -p "$ROOT/logs"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ >"$LOCK_DIR/pid"; trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM; return 0
  fi
  # 锁已存在:看持有者是否还活着
  local oldpid; oldpid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    return 1   # 上一轮仍在运行
  fi
  # 陈旧锁(持有者已死),接管
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ >"$LOCK_DIR/pid"; trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM; return 0
  fi
  return 1
}

# 哨兵 / 标记(用于区分 AI 评论与人工回复)
AI_SENTINEL="$(jq -r '.confirmation.ai_sentinel // "🤖"' "$CONFIG" 2>/dev/null || echo '🤖')"
NEEDS_CONFIRM_MARKER="$(jq -r '.confirmation.needs_confirm_marker // "[AI-NEEDS-CONFIRM]"' "$CONFIG" 2>/dev/null || echo '[AI-NEEDS-CONFIRM]')"

# cfg <jq-filter> [default] — 读 config.json 的某个值
cfg() {
  local val
  val="$(jq -r "$1 // empty" "$CONFIG")"
  if [ -z "$val" ] && [ $# -ge 2 ]; then echo "$2"; else echo "$val"; fi
}

# log_line <msg> — 追加一行到 logs/YYYY-MM-DD.log(本地时区),并回显
log_line() {
  local dir; dir="$ROOT/$(cfg '.logging.local_log_dir' logs)"
  mkdir -p "$dir"
  local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
  local day; day="$(date '+%Y-%m-%d')"
  printf '%s | %s\n' "$ts" "$1" | tee -a "$dir/$day.log"
}

# resolve_tasklists — 发现 AI 队列清单,写缓存 state.json,stdout 输出 {guid,name} JSONL
# 规则:tasklist_guids 非空 => 只认白名单;否则取清单名以 prefix 开头(大小写不敏感)的。
resolve_tasklists() {
  local prefix; prefix="$(cfg '.queue.tasklist_name_prefix' AI)"
  local whitelist; whitelist="$(jq -c '.queue.tasklist_guids // []' "$CONFIG")"
  local state; state="$ROOT/$(cfg '.queue.state_file' config/state.json)"

  local all; all="$(LARK task tasklists list 2>/dev/null | jq -c '[.data.items[]? | {guid, name}]')"

  local matched
  if [ "$whitelist" != "[]" ]; then
    matched="$(jq -c --argjson wl "$whitelist" '[.[] | select(.guid as $g | $wl | index($g))]' <<<"$all")"
  else
    matched="$(jq -c --arg p "$prefix" '[.[] | select(.name | ascii_downcase | startswith($p | ascii_downcase))]' <<<"$all")"
  fi

  # 写缓存(含解析时间);失败不致命
  jq -n --argjson lists "$matched" --arg at "$(date '+%Y-%m-%d %H:%M:%S')" \
    '{resolved_at:$at, tasklists:$lists}' >"$state" 2>/dev/null || true

  jq -c '.[]' <<<"$matched"
}

# list_pending <tasklist_guid> — 输出该清单未完成任务 JSONL {guid, summary}
list_pending() {
  LARK task tasklists tasks --params "{\"tasklist_guid\":\"$1\",\"completed\":false,\"page_size\":100}" \
    | jq -c '.data.items[]? | {guid: .guid, summary: .summary}'
}

# task_detail <task_guid> — 输出 {guid, summary, description, url, repeat_rule, completed_at}
task_detail() {
  LARK task tasks get --params "{\"task_guid\":\"$1\"}" \
    | jq -c '.data.task | {guid, summary, description, url, repeat_rule: (.repeat_rule // ""), completed_at: (.completed_at // "0")}'
}

# add_comment <task_guid> <content>
add_comment() { LARK task +comment --task-id "$1" --content "$2"; }

# complete_task <task_guid>
complete_task() { LARK task +complete --task-id "$1"; }

# create_doc <xml_content> — 建飞书文档,stdout 仅输出分享 url
create_doc() {
  local folder; folder="$(cfg '.output.doc_folder_token')"
  local args=(docs +create --api-version v2 --content "$1")
  [ -n "$folder" ] && args+=(--parent-token "$folder")
  LARK "${args[@]}" | jq -r '.data.document.url'
}

# list_comments <task_guid> — 输出任务评论 JSONL {id, content, creator_id, created_at(ms,number)},按时间升序
list_comments() {
  API_GET "/open-apis/task/v2/comments" "{\"resource_type\":\"task\",\"resource_id\":\"$1\",\"page_size\":100}" \
    | jq -c '[.data.items[]? | {id, content, creator_id: .creator.id, created_at: (.created_at|tonumber? // 0)}] | sort_by(.created_at) | .[]'
}

# check_confirmation <task_guid> — 异步确认状态机,输出 JSON:
#   {"state":"none"}                          没有待确认
#   {"state":"waiting"}                       发过确认请求,但你还没回复
#   {"state":"confirmed","reply":"<你的回复>"}  你已回复,可继续推进
check_confirmation() {
  local comments; comments="$(list_comments "$1" | jq -s '.')"
  jq -cn --argjson cs "$comments" --arg marker "$NEEDS_CONFIRM_MARKER" --arg sent "$AI_SENTINEL" '
    ($cs | map(select(.content | contains($marker)))) as $confirms |
    if ($confirms|length)==0 then {state:"none"}
    else ($confirms[-1].created_at) as $t |
      ($cs | map(select(.created_at > $t and ((.content|startswith($sent))|not)))) as $replies |
      if ($replies|length)>0 then {state:"confirmed", reply: ($replies|map(.content)|join("\n"))}
      else {state:"waiting"} end
    end'
}

# recurring_done_today <task_guid> — 当天(本地)是否已有 AI 结果评论(=今天已干过)。0=已干,1=未干
recurring_done_today() {
  local today; today="$(date '+%Y-%m-%d')"
  local n
  n="$(list_comments "$1" | jq -s --arg sent "$AI_SENTINEL" --arg marker "$NEEDS_CONFIRM_MARKER" --arg today "$today" '
    [ .[] | select((.content|startswith($sent)) and ((.content|contains($marker))|not))
          | select((.created_at/1000 | strflocaltime("%Y-%m-%d")) == $today) ] | length')"
  [ "${n:-0}" -gt 0 ]
}

# is_recurring <summary> <description> [repeat_rule] — 是否重复任务。0=是,1=否
is_recurring() {
  local text="$1 ${2:-}"
  local rr="${3:-}"
  [ -n "$rr" ] && [ "$rr" != "null" ] && return 0
  local m
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    case "$text" in *"$m"*) return 0;; esac
  done < <(jq -r '.recurring.markers[]?' "$CONFIG" 2>/dev/null)
  return 1
}

# notify <markdown> — 每轮结束发飞书汇总。渠道由 config.notify.channel 决定:off|bot|webhook
notify() {
  local ch; ch="$(cfg '.notify.channel' bot)"
  case "$ch" in
    off)
      return 0 ;;
    webhook)
      local url; url="$(cfg '.notify.webhook_url')"
      [ -n "$url" ] || { echo "[notify] channel=webhook 但未配 webhook_url,跳过"; return 0; }
      # 飞书群自定义机器人:发 text 消息(纯文本,不渲染 markdown)
      local payload; payload="$(jq -n --arg t "$1" '{msg_type:"text", content:{text:$t}}')"
      curl -s -X POST "$url" -H 'Content-Type: application/json' -d "$payload" | jq -c '{code, msg}' ;;
    bot|*)
      local who; who="$(cfg '.notify.user_open_id')"
      [ -n "$who" ] || { echo "[notify] channel=bot 但未配 user_open_id,跳过"; return 0; }
      lark-cli im +messages-send --as bot --user-id "$who" --markdown "$1" --json \
        | jq -c '{ok, msg_id: .data.message_id}' ;;
  esac
}

# count_actionable — 数出本轮真正需要唤起 Claude 处理的任务数(纯 shell 预筛,省 token)。
# 跳过:等待人工确认(waiting) / 重复任务且今天已干过。stdout 仅输出一个数字。
count_actionable() {
  local items; items="$(bash "$ROOT/scripts/pull-queue.sh")"
  local len; len="$(jq 'length' <<<"$items" 2>/dev/null || echo 0)"
  local n=0 i=0 guid summary desc rr conf
  while [ "$i" -lt "$len" ]; do
    guid="$(jq -r ".[$i].guid" <<<"$items")"
    summary="$(jq -r ".[$i].summary // \"\"" <<<"$items")"
    desc="$(jq -r ".[$i].description // \"\"" <<<"$items")"
    rr="$(jq -r ".[$i].repeat_rule // \"\"" <<<"$items")"
    conf="$(check_confirmation "$guid" | jq -r '.state')"
    i=$((i+1))
    [ "$conf" = "waiting" ] && continue
    if is_recurring "$summary" "$desc" "$rr" && recurring_done_today "$guid"; then continue; fi
    n=$((n+1))
  done
  echo "$n"
}
