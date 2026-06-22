// core/confirm.mjs — 异步人工确认状态机 + 重复任务判定。
//
// 纯逻辑函数(evaluateConfirmation / recurringDoneOn / isRecurringText / isActionable
// / normalizeComments)不碰 I/O,可被单测直接覆盖;带 I/O 的函数仅做
// "拉评论 → 调纯函数"的薄封装。

import { localDate } from '../util.mjs';
import { listComments } from './lark.mjs';
import { sentinel, confirmMarker, successMark, timezone, getConfig } from './config.mjs';

/**
 * 把飞书评论原始 items 规整为按时间升序的精简结构。
 * content 一律强制为字符串,防御 null/非串输入。
 * @returns {{id:any, content:string, creator_id:any, created_at:number}[]}
 */
export function normalizeComments(items) {
  return (items || [])
    .map((c) => ({
      id: c.id,
      content: typeof c.content === 'string' ? c.content : String(c.content ?? ''),
      creator_id: c.creator?.id,
      created_at: Number(c.created_at) || 0, // 毫秒
    }))
    .sort((a, b) => a.created_at - b.created_at);
}

/**
 * 异步确认状态机(纯函数)。
 * 确认请求必须是 AI 评论(以哨兵开头)且含确认标记 —— 否则用户回复里引用该标记会被误判。
 * - none:没有发过确认请求
 * - waiting:发过确认请求,但其后没有你的(非 AI)回复
 * - confirmed:确认请求之后出现了你的回复 → reply 为回复内容
 * @param {{content:string, created_at:number}[]} comments 升序评论
 */
export function evaluateConfirmation(comments, marker, sent) {
  const confirms = comments.filter((c) => c.content.startsWith(sent) && c.content.includes(marker));
  if (confirms.length === 0) return { state: 'none' };
  const lastAt = confirms[confirms.length - 1].created_at;
  const replies = comments.filter((c) => c.created_at > lastAt && !c.content.startsWith(sent));
  if (replies.length > 0) {
    return { state: 'confirmed', reply: replies.map((r) => r.content).join('\n') };
  }
  return { state: 'waiting' };
}

/**
 * 指定日期(某时区)是否已有 AI 成功结果评论(=今天已干过)。纯函数。
 * 成功结果 = 以哨兵开头、含成功标记(✅)、且不含确认标记的 AI 评论。
 * 失败评论(🤖 ❌ …)不算"已干",以便重复任务当天可重试。
 */
export function recurringDoneOn(comments, sent, marker, doneMark, today, tz) {
  return comments.some(
    (c) =>
      c.content.startsWith(sent) &&
      c.content.includes(doneMark) &&
      !c.content.includes(marker) &&
      localDate(c.created_at, tz) === today,
  );
}

/** 是否重复任务(纯函数):有飞书重复规则,或文本命中任一 marker。 */
export function isRecurringText(markers, text, repeatRule) {
  if (repeatRule && repeatRule !== 'null') return true;
  return (markers || []).some((m) => m && text.includes(m));
}

/**
 * 给定一条任务及其评论,判断本轮是否需要唤起 claude 处理(纯函数)。
 * 跳过:等待人工确认(waiting)、重复任务且今天已成功干过。
 * @param {{summary:string, description?:string, repeat_rule?:string}} item
 * @param {{content:string, created_at:number}[]} comments 升序评论
 */
export function isActionable(item, comments, opts) {
  const { markers, sentinel: sent, marker, doneMark, today, tz } = opts;
  if (evaluateConfirmation(comments, marker, sent).state === 'waiting') return false;
  const text = `${item.summary} ${item.description ?? ''}`;
  if (isRecurringText(markers, text, item.repeat_rule) && recurringDoneOn(comments, sent, marker, doneMark, today, tz)) {
    return false;
  }
  return true;
}

// ── I/O 薄封装 ──────────────────────────────────────────────────────────────

/** 拉评论并求确认状态。 */
export function checkConfirmation(taskGuid) {
  const comments = normalizeComments(listComments(taskGuid));
  return evaluateConfirmation(comments, confirmMarker(), sentinel());
}

/** 拉评论并判断该重复任务今天是否已成功干过。 */
export function recurringDoneToday(taskGuid) {
  const comments = normalizeComments(listComments(taskGuid));
  const today = localDate(Date.now(), timezone());
  return recurringDoneOn(comments, sentinel(), confirmMarker(), successMark(), today, timezone());
}

/** 判断任务是否重复任务(读 config 的 markers)。 */
export function isRecurring(summary, description, repeatRule) {
  const markers = getConfig('recurring.markers', []);
  return isRecurringText(markers, `${summary} ${description ?? ''}`, repeatRule);
}
