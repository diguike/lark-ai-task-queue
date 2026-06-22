#!/usr/bin/env bash
# pull-queue.sh — 发现 AI 队列清单 + 拉取所有未完成任务,输出一个 JSON 数组到 stdout。
# 给 Claude(执行器)消费,或人工 `bash scripts/pull-queue.sh | jq` 查看队列。
# 每项: {tasklist_name, tasklist_guid, guid, summary, description, url}
# 已按 max_tasks_per_run 截断(取最先返回的若干条)。

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MAX="$(cfg '.execution.max_tasks_per_run' 3)"

items='[]'
while IFS= read -r tl; do
  [ -z "$tl" ] && continue
  tl_guid="$(jq -r '.guid' <<<"$tl")"
  tl_name="$(jq -r '.name' <<<"$tl")"
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    t_guid="$(jq -r '.guid' <<<"$t")"
    detail="$(task_detail "$t_guid")"
    row="$(jq -c --arg tn "$tl_name" --arg tg "$tl_guid" \
      '{tasklist_name:$tn, tasklist_guid:$tg, guid:.guid, summary:.summary, description:.description, url:.url, repeat_rule:.repeat_rule}' <<<"$detail")"
    items="$(jq -c --argjson r "$row" '. + [$r]' <<<"$items")"
  done < <(list_pending "$tl_guid")
done < <(resolve_tasklists)

# 截断到 max_tasks_per_run
jq -c --argjson n "$MAX" '.[0:$n]' <<<"$items"
