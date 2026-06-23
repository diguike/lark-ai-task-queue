// core/confirm.mjs — 异步人工确认状态机 + 重复任务判定。
//
// 纯逻辑函数(evaluateConfirmation / recurringDoneOn / isRecurringText / isActionable
// / normalizeComments)不碰 I/O,可被单测直接覆盖;带 I/O 的函数仅做
// "拉评论 → 调纯函数"的薄封装。

import { localDate, localTimeMinutes, zonedParts } from '../util.mjs';
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
 * 最近一条 AI 成功结果评论的时间戳(ms),无则 0。纯函数。
 * 成功结果 = 以哨兵开头、含成功标记(✅)、且不含确认标记的 AI 评论。
 * 失败评论(🤖 ❌ …)不算"已干",以便重复任务当天/到点可重试。
 */
export function lastRecurringSuccessAt(comments, sent, marker, doneMark) {
  let last = 0;
  for (const c of comments || []) {
    if (
      c.content.startsWith(sent) &&
      c.content.includes(doneMark) &&
      !c.content.includes(marker) &&
      c.created_at > last
    ) {
      last = c.created_at;
    }
  }
  return last;
}

/**
 * 指定日期(某时区)是否已有 AI 成功结果评论(=今天已干过)。纯函数。
 * 自然日去重:供无参数标记([每日]/[每天]/…)使用,跨午夜才重置。
 */
export function recurringDoneOn(comments, sent, marker, doneMark, today, tz) {
  const last = lastRecurringSuccessAt(comments, sent, marker, doneMark);
  return last > 0 && localDate(last, tz) === today;
}

// 间隔单位 → 毫秒。中文为主,兼容 h/m/d 缩写。
const UNIT_MS = {
  分钟: 60_000, 分: 60_000, m: 60_000,
  小时: 3_600_000, 时: 3_600_000, h: 3_600_000,
  天: 86_400_000, d: 86_400_000,
};
// 交替项把长单位放前面,避免「分钟」先被「分」截断。
const EVERY_RE = /\[\s*每\s*(\d+)\s*(分钟|小时|分|时|天|h|m|d)\s*\]/;

/**
 * 解析"滚动间隔"标记 [每N分钟]/[每N小时]/[每N天](纯函数)。
 * 命中返回间隔毫秒(>0),否则返回 null。无数字的 [每日]/[每天] 不在此列
 * —— 那些走自然日对齐(recurringDoneOn),由 isRecurringText 识别。
 */
export function parseEveryInterval(text) {
  const m = EVERY_RE.exec(text || '');
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n * UNIT_MS[m[2]];
}

// 活跃时段窗口 [HH:MM-HH:MM](支持 - 或 ~ 分隔)。
const WINDOW_RE = /\[\s*(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})\s*\]/;

/**
 * 解析活跃时段窗口 [09:00-22:00](纯函数)。
 * 返回 {start,end} 为当日分钟数(0..1439),非法时分返回 null。
 */
export function parseActiveWindow(text) {
  const m = WINDOW_RE.exec(text || '');
  if (!m) return null;
  const [sh, sm, eh, em] = [m[1], m[2], m[3], m[4]].map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

/**
 * 当前(某时区)是否落在活跃时段窗口内(纯函数)。
 * start<end 普通区间(含头不含尾);start>end 跨午夜;start==end 视为全天。
 */
export function withinActiveWindow(nowMs, win, tz) {
  if (!win) return true;
  const cur = localTimeMinutes(nowMs, tz);
  if (win.start === win.end) return true;
  if (win.start < win.end) return cur >= win.start && cur < win.end;
  return cur >= win.start || cur < win.end; // 跨午夜,如 [22:00-02:00]
}

// ── cron 表达式调度 ──────────────────────────────────────────────────────────
// [cron: 分 时 日 月 周] 给程序员精确控制;[每日 HH:MM] 是其语法糖(= "M H * * *")。
// 轮询式判定:不要求精确到分秒触发,而是"上次成功之后是否又跨过了一个 cron 匹配点"。

const MINUTE = 60_000;
const CRON_MAX_LOOKBACK_MS = 35 * 86_400_000; // 停跑超 35 天则保守视为到期,且封顶扫描成本

/**
 * 解析单个 cron 字段为 {set:Set<number>, star:boolean}(纯函数)。
 * 支持 *、a、a-b、星号步长 、a-b/n、逗号列表;非法返回 null。
 */
export function parseCronField(field, lo, hi) {
  const set = new Set();
  let star = false;
  for (const part of String(field).split(',')) {
    let m;
    if (part === '*') {
      star = true;
      for (let i = lo; i <= hi; i++) set.add(i);
    } else if ((m = /^\*\/(\d+)$/.exec(part))) {
      const step = Number(m[1]);
      if (step <= 0) return null;
      for (let i = lo; i <= hi; i += step) set.add(i);
    } else if ((m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(part))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const step = m[3] ? Number(m[3]) : 1;
      if (step <= 0 || a < lo || b > hi || a > b) return null;
      for (let i = a; i <= b; i += step) set.add(i);
    } else if ((m = /^(\d+)$/.exec(part))) {
      const v = Number(m[1]);
      if (v < lo || v > hi) return null;
      set.add(v);
    } else {
      return null;
    }
  }
  return { set, star };
}

/**
 * 解析 5 字段 cron 表达式(分 时 日 月 周)为调度对象(纯函数),非法返回 null。
 * 周字段 0/7 均表示周日。日/周字段记录是否为 *,以实现 Vixie cron 的"日与周都受限则取并集"语义。
 */
export function parseCronExpr(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseCronField(f[0], 0, 59);
  const hour = parseCronField(f[1], 0, 23);
  const dom = parseCronField(f[2], 1, 31);
  const month = parseCronField(f[3], 1, 12);
  const dow = parseCronField(f[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.set.has(7)) dow.set.add(0); // 7 → 周日
  return {
    minute: minute.set,
    hour: hour.set,
    dom: dom.set,
    domStar: dom.star,
    month: month.set,
    dow: dow.set,
    dowStar: dow.star,
  };
}

/**
 * 从任务文本解析调度计划(纯函数):优先 [cron: …],其次 [每日 HH:MM]/[每天 HH:MM]。
 * 返回 parseCronExpr 结构或 null。[每日](无时间)不在此列 —— 那走自然日对齐。
 */
export function parseSchedule(text) {
  const t = text || '';
  let m = /\[\s*cron:\s*([^\]]+?)\s*\]/i.exec(t);
  if (m) return parseCronExpr(m[1]);
  m = /\[\s*每[日天]\s+(\d{1,2}):(\d{2})\s*\]/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return parseCronExpr(`${min} ${h} * * *`);
  }
  return null;
}

/** 某绝对时刻(按 tz 的墙钟)是否匹配 cron 调度(纯函数)。 */
export function cronMatches(sched, ms, tz) {
  const p = zonedParts(ms, tz);
  if (!sched.minute.has(p.minute)) return false;
  if (!sched.hour.has(p.hour)) return false;
  if (!sched.month.has(p.month)) return false;
  const domOk = sched.dom.has(p.day);
  const dowOk = sched.dow.has(p.weekday);
  // Vixie 语义:日、周都受限 → 满足其一即可;否则两者(各自含 *)同时成立。
  return sched.domStar || sched.dowStar ? domOk && dowOk : domOk || dowOk;
}

/**
 * cron 任务本轮是否到期(纯函数)。
 * - 从没成功过(lastMs=0)→ 立即跑一次(与间隔任务首跑行为一致);
 * - 否则"上次成功之后到现在之间存在一个 cron 匹配分钟"即到期;
 * - 叠加活跃时段窗口 win 时,匹配点本身须落在窗口内才算数(窗口外的命中点不补跑);
 * - 逐分钟回扫,最多回溯 35 天(停跑过久则保守判到期),把扫描成本封顶。
 * 注:按绝对分钟扫描,DST 回拨日同一墙钟分钟会对应两个绝对分钟,极端下可能多跑一次
 * (一年一次、特定时区、刚好命中)——视为可接受,重复任务多跑一轮无害,不做去重。
 */
export function cronDue(sched, lastMs, nowMs, tz, win = null) {
  const hit = (t) => cronMatches(sched, t, tz) && withinActiveWindow(t, win, tz);
  if (!lastMs) return win ? withinActiveWindow(nowMs, win, tz) : true;
  const floor = Math.max(lastMs, nowMs - CRON_MAX_LOOKBACK_MS);
  for (let t = Math.floor(nowMs / MINUTE) * MINUTE; t > lastMs && t >= floor; t -= MINUTE) {
    if (hit(t)) return true;
  }
  return lastMs < nowMs - CRON_MAX_LOOKBACK_MS; // 超回溯窗口仍未命中 → 早该跑了
}

// "声明意图"探测(宽松,不校验合法性):用于区分"未声明调度"与"声明了但写错"。
// 写错的标记(如 [cron: 99 …]/[每日 25:00]/[每0分钟])不该让任务被当一次性任务划掉。
const CRON_INTENT_RE = /\[\s*cron:/i;
const DAILY_AT_INTENT_RE = /\[\s*每[日天]\s+\d/;
const EVERY_INTENT_RE = /\[\s*每\s*\d/;

/** 文本是否声明了任一频率标记(cron / 每日定点 / 每N间隔),不论写得对不对。纯函数。 */
export function hasScheduleMarker(text) {
  const t = text || '';
  return CRON_INTENT_RE.test(t) || DAILY_AT_INTENT_RE.test(t) || EVERY_INTENT_RE.test(t);
}

/**
 * 是否重复任务(纯函数):有飞书重复规则、命中任一 marker、或声明了任一频率标记
 * (cron/每日定点/间隔,即便写错)。重复任务做完只追评论、绝不划掉,故都须在此被认出
 * —— 写错的频率标记尤其不能漏,否则会被误当一次性任务划掉。
 */
export function isRecurringText(markers, text, repeatRule) {
  if (repeatRule && repeatRule !== 'null') return true;
  if (hasScheduleMarker(text)) return true;
  return (markers || []).some((m) => m && text.includes(m));
}

/**
 * 飞书"开始时间"是否已到(纯函数)。未设开始时间 → 永远视为已到。
 * - 精确到时间:now >= 开始时间戳;
 * - 精确到日期(is_all_day):当天(按 tz)>= 开始日期即可。
 * @param {number} startTs 开始时间戳(ms),0/falsy 表示未设
 * @param {boolean} isAllDay 是否只精确到日期
 * @param {number} nowMs 当前时间戳(ms)
 * @param {string|undefined} tz 时区
 */
export function startReached(startTs, isAllDay, nowMs, tz) {
  if (!startTs) return true;
  if (isAllDay) return localDate(nowMs, tz) >= localDate(startTs, tz);
  return nowMs >= startTs;
}

/**
 * 给定一条任务及其评论,判断本轮是否需要唤起 claude 处理(纯函数)。
 * 跳过:等待人工确认(waiting)、重复任务且今天已成功干过。
 * @param {{summary:string, description?:string, repeat_rule?:string}} item
 * @param {{content:string, created_at:number}[]} comments 升序评论
 */
export function isActionable(item, comments, opts) {
  const { markers, sentinel: sent, marker, doneMark, now, today, tz } = opts;
  // 飞书"开始时间"未到 → 本轮不执行,等到点的下一轮再说。
  if (!startReached(item.start_ts, item.start_all_day, now, tz)) return false;
  if (evaluateConfirmation(comments, marker, sent).state === 'waiting') return false;
  const text = `${item.summary} ${item.description ?? ''}`;
  // 活跃时段窗口:声明了窗口但写错([25:00-…])→ 保守不执行,停队列等修正;
  // 写对了但当前在窗口外([09:00-22:00] 的夜间)→ 本轮不执行。
  const winDeclared = WINDOW_RE.test(text);
  const win = parseActiveWindow(text);
  if (winDeclared && !win) return false;
  if (!withinActiveWindow(now, win, tz)) return false;
  // 频率标记声明了但全写错(无合法 cron/每日定点/间隔)→ 保守不执行,避免误跑/被划掉。
  const sched = parseSchedule(text);
  const intervalMs = parseEveryInterval(text);
  if (hasScheduleMarker(text) && !sched && intervalMs == null) return false;
  // 重复频率,优先级 cron > 间隔 > 自然日:
  // [cron: …]/[每日 HH:MM] 精确调度;[每N分钟/小时/天] 滚动间隔;无参数标记自然日对齐。
  if (sched) {
    return cronDue(sched, lastRecurringSuccessAt(comments, sent, marker, doneMark), now, tz, win);
  }
  if (intervalMs != null) {
    const last = lastRecurringSuccessAt(comments, sent, marker, doneMark);
    return !(last > 0 && now - last < intervalMs);
  }
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

/**
 * 拉评论并判断该重复任务"本周期内是否已成功干过"(=本轮应跳过)。
 * 传入 summary/description 时:带 [每N分钟/小时/天] 间隔标记的走滚动窗口
 * (距上次成功 < 间隔即视为已干过);否则回落自然日对齐。
 * 不传文本时退化为自然日(向后兼容 guid-only 调用)。
 */
export function recurringDoneToday(taskGuid, summary = '', description = '') {
  const comments = normalizeComments(listComments(taskGuid));
  const tz = timezone();
  const now = Date.now();
  const text = `${summary} ${description ?? ''}`;
  const sched = parseSchedule(text);
  if (sched) {
    // 到期=可跑;"已干过"=尚未到期。窗口与 isActionable 保持一致。
    const win = parseActiveWindow(text);
    return !cronDue(sched, lastRecurringSuccessAt(comments, sentinel(), confirmMarker(), successMark()), now, tz, win);
  }
  const intervalMs = parseEveryInterval(text);
  if (intervalMs != null) {
    const last = lastRecurringSuccessAt(comments, sentinel(), confirmMarker(), successMark());
    return last > 0 && now - last < intervalMs;
  }
  const today = localDate(now, tz);
  return recurringDoneOn(comments, sentinel(), confirmMarker(), successMark(), today, tz);
}

/** 判断任务是否重复任务(读 config 的 markers)。 */
export function isRecurring(summary, description, repeatRule) {
  const markers = getConfig('recurring.markers', []);
  return isRecurringText(markers, `${summary} ${description ?? ''}`, repeatRule);
}
