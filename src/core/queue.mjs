// core/queue.mjs — 队列发现、拉取与省 token 预筛。

import { writeAtomic, nowStamp, localDate } from '../util.mjs';
import { getConfig, statePath, timezone, sentinel, confirmMarker, successMark } from './config.mjs';
import { listTasklists, listPendingTasks, getTask, listComments } from './lark.mjs';
import { normalizeComments, isActionable } from './confirm.mjs';

/**
 * 从全部清单里筛出 AI 队列清单(纯函数)。
 * whitelist 非空 → 只认白名单;否则取名字以 prefix 开头(大小写不敏感)的。
 * @returns {{guid:string, name:string}[]}
 */
export function filterTasklists(items, prefix, whitelist) {
  const lists = (items || []).map((x) => ({ guid: x.guid, name: x.name }));
  if (Array.isArray(whitelist) && whitelist.length > 0) {
    return lists.filter((x) => whitelist.includes(x.guid));
  }
  const p = (prefix || '').toLowerCase();
  return lists.filter((x) => (x.name || '').toLowerCase().startsWith(p));
}

/** 把任务详情投影成队列条目(纯函数)。 */
export function projectTask(task, tasklistName, tasklistGuid) {
  return {
    tasklist_name: tasklistName,
    tasklist_guid: tasklistGuid,
    guid: task.guid,
    summary: task.summary,
    description: task.description,
    url: task.url,
    repeat_rule: task.repeat_rule || '',
    start_ts: Number(task.start?.timestamp) || 0, // 飞书"开始时间"(ms),0=未设
    start_all_day: Boolean(task.start?.is_all_day), // 开始时间是否只精确到日期
  };
}

/** 发现 AI 队列清单,写缓存 state.json(失败不致命),返回 [{guid,name}]。 */
export function resolveTasklists() {
  const prefix = getConfig('queue.tasklist_name_prefix', 'AI');
  const whitelist = getConfig('queue.tasklist_guids', []);
  const matched = filterTasklists(listTasklists(), prefix, whitelist);
  try {
    writeAtomic(
      statePath(),
      JSON.stringify({ resolved_at: nowStamp(timezone()), tasklists: matched }) + '\n',
    );
  } catch {
    /* 缓存写失败不影响主流程 */
  }
  return matched;
}

/** 收集所有 AI 队列里的未完成任务详情(不截断)。 */
function collectPending() {
  const items = [];
  for (const tl of resolveTasklists()) {
    for (const pending of listPendingTasks(tl.guid)) {
      items.push(projectTask(getTask(pending.guid), tl.name, tl.guid));
    }
  }
  return items;
}

/**
 * 从 (任务, 评论) 列表里挑出可执行任务,截断到 max(纯函数)。
 * 关键:先按可执行性过滤、再截断 —— 否则前 N 条都在等确认时,后面可执行的任务永远轮不到。
 * @param {{item:object, comments:object[]}[]} entries
 */
export function selectActionable(entries, opts, max) {
  const out = [];
  for (const { item, comments } of entries) {
    if (isActionable(item, comments, opts)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 拉取本轮"真正需要 claude 处理"的任务,按 max_tasks_per_run 截断。
 * 每条任务只拉一次评论,同时供确认状态机与重复判定使用。
 * @returns 队列条目数组(projectTask 结构)
 */
export function pullQueue() {
  const max = getConfig('execution.max_tasks_per_run', 3);
  const now = Date.now();
  const opts = {
    markers: getConfig('recurring.markers', []),
    sentinel: sentinel(),
    marker: confirmMarker(),
    doneMark: successMark(),
    now,
    today: localDate(now, timezone()),
    tz: timezone(),
  };
  const entries = collectPending().map((item) => ({
    item,
    comments: normalizeComments(listComments(item.guid)),
  }));
  return selectActionable(entries, opts, max);
}

/** 省 token 预筛:本轮需要唤起 claude 的任务数(= 即将交给 claude 的条数)。 */
export function countActionable() {
  return pullQueue().length;
}
