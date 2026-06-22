import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComments,
  evaluateConfirmation,
  recurringDoneOn,
  isRecurringText,
  isActionable,
  startReached,
} from '../src/core/confirm.mjs';

const SENT = '🤖';
const MARK = '[AI-NEEDS-CONFIRM]';
const DONE = '✅';

test('normalizeComments: 提取字段、按时间升序、content 强制字符串', () => {
  const raw = [
    { id: 2, content: 'b', creator: { id: 'u2' }, created_at: '2000' },
    { id: 1, content: 'a', creator: { id: 'u1' }, created_at: '1000' },
    { id: 3, content: null, created_at: '3000' },
  ];
  const got = normalizeComments(raw);
  assert.deepEqual(
    got.map((c) => c.id),
    [1, 2, 3],
  );
  assert.equal(got[0].created_at, 1000);
  assert.equal(got[0].creator_id, 'u1');
  assert.equal(got[2].content, ''); // null → ''
});

test('evaluateConfirmation: 没有确认请求 → none', () => {
  const comments = normalizeComments([{ content: '🤖 ✅ 已完成', created_at: '1000' }]);
  assert.deepEqual(evaluateConfirmation(comments, MARK, SENT), { state: 'none' });
});

test('evaluateConfirmation: 发过确认但无人回复 → waiting', () => {
  const comments = normalizeComments([{ content: `${SENT} ${MARK} 要删库吗?`, created_at: '1000' }]);
  assert.deepEqual(evaluateConfirmation(comments, MARK, SENT), { state: 'waiting' });
});

test('evaluateConfirmation: 确认请求后出现人工回复 → confirmed', () => {
  const comments = normalizeComments([
    { content: `${SENT} ${MARK} 要删库吗?`, created_at: '1000' },
    { content: '确认,删吧', created_at: '2000' },
  ]);
  assert.deepEqual(evaluateConfirmation(comments, MARK, SENT), { state: 'confirmed', reply: '确认,删吧' });
});

test('evaluateConfirmation: 确认请求后只有 AI 自己的评论 → 仍 waiting', () => {
  const comments = normalizeComments([
    { content: `${SENT} ${MARK} 要删库吗?`, created_at: '1000' },
    { content: `${SENT} 仍在等待`, created_at: '2000' },
  ]);
  assert.equal(evaluateConfirmation(comments, MARK, SENT).state, 'waiting');
});

test('evaluateConfirmation: 用户回复里引用 marker 不应被当成新的确认请求', () => {
  // 回归:确认请求必须以哨兵开头;用户引用 [AI-NEEDS-CONFIRM] 只是回复
  const comments = normalizeComments([
    { content: `${SENT} ${MARK} 选 A 还是 B?`, created_at: '1000' },
    { content: `关于你说的 ${MARK},我选 A`, created_at: '2000' },
  ]);
  const r = evaluateConfirmation(comments, MARK, SENT);
  assert.equal(r.state, 'confirmed');
  assert.equal(r.reply, `关于你说的 ${MARK},我选 A`);
});

test('evaluateConfirmation: 多次回复 → 合并', () => {
  const comments = normalizeComments([
    { content: `${SENT} ${MARK} 选 A 还是 B?`, created_at: '1000' },
    { content: '选 A', created_at: '2000' },
    { content: '补充:用方案一', created_at: '3000' },
  ]);
  const r = evaluateConfirmation(comments, MARK, SENT);
  assert.equal(r.state, 'confirmed');
  assert.equal(r.reply, '选 A\n补充:用方案一');
});

test('recurringDoneOn: 当天有成功结果评论 → true', () => {
  const ms = Date.UTC(2026, 5, 22, 1, 0, 0);
  const comments = normalizeComments([
    { content: `${SENT} ${DONE} 2026-06-22 已执行`, created_at: String(ms) },
  ]);
  assert.equal(recurringDoneOn(comments, SENT, MARK, DONE, '2026-06-22', 'UTC'), true);
  assert.equal(recurringDoneOn(comments, SENT, MARK, DONE, '2026-06-23', 'UTC'), false);
});

test('recurringDoneOn: 失败评论不算"已干过"(当天可重试)', () => {
  const ms = Date.UTC(2026, 5, 22, 1, 0, 0);
  const comments = normalizeComments([
    { content: `${SENT} ❌ 执行失败:超时`, created_at: String(ms) },
  ]);
  assert.equal(recurringDoneOn(comments, SENT, MARK, DONE, '2026-06-22', 'UTC'), false);
});

test('recurringDoneOn: 确认请求 / 人工评论都不算"已干过"', () => {
  const ms = Date.UTC(2026, 5, 22, 1, 0, 0);
  const confirm = normalizeComments([{ content: `${SENT} ${MARK} 需确认`, created_at: String(ms) }]);
  const human = normalizeComments([{ content: `${DONE} 辛苦了`, created_at: String(ms) }]);
  assert.equal(recurringDoneOn(confirm, SENT, MARK, DONE, '2026-06-22', 'UTC'), false);
  assert.equal(recurringDoneOn(human, SENT, MARK, DONE, '2026-06-22', 'UTC'), false); // 非哨兵开头
});

test('isRecurringText: 飞书重复规则优先', () => {
  assert.equal(isRecurringText([], 'x', '{"freq":"DAILY"}'), true);
  assert.equal(isRecurringText([], 'x', 'null'), false);
  assert.equal(isRecurringText([], 'x', ''), false);
});

test('isRecurringText: 命中标记', () => {
  const markers = ['[每日]', '[daily]'];
  assert.equal(isRecurringText(markers, '写周报 [每日]', ''), true);
  assert.equal(isRecurringText(markers, 'daily report', ''), false);
  assert.equal(isRecurringText(markers, '一次性任务', ''), false);
});

test('startReached: 未设开始时间 → 永远视为已到', () => {
  assert.equal(startReached(0, false, Date.now(), 'UTC'), true);
  assert.equal(startReached(undefined, false, Date.now(), 'UTC'), true);
});

test('startReached: 精确到时间 → now>=start 才到', () => {
  const start = Date.UTC(2026, 5, 22, 10, 0, 0);
  assert.equal(startReached(start, false, start - 1000, 'UTC'), false); // 早一秒
  assert.equal(startReached(start, false, start, 'UTC'), true);
  assert.equal(startReached(start, false, start + 1000, 'UTC'), true);
});

test('startReached: 精确到日期(is_all_day)→ 当天起算', () => {
  const startDay = Date.UTC(2026, 5, 23, 0, 0, 0); // 6/23
  assert.equal(startReached(startDay, true, Date.UTC(2026, 5, 22, 23, 0, 0), 'UTC'), false); // 6/22 当晚
  assert.equal(startReached(startDay, true, Date.UTC(2026, 5, 23, 1, 0, 0), 'UTC'), true); // 6/23 凌晨
});

test('isActionable: 开始时间未到 → 不可执行(即便无确认/非重复)', () => {
  const now = Date.UTC(2026, 5, 22, 12, 0, 0);
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now, today: '2026-06-22', tz: 'UTC' };
  const future = { summary: '稍后', description: '', repeat_rule: '', start_ts: now + 3600_000, start_all_day: false };
  const past = { summary: '可做', description: '', repeat_rule: '', start_ts: now - 3600_000, start_all_day: false };
  assert.equal(isActionable(future, [], opts), false);
  assert.equal(isActionable(past, [], opts), true);
});

test('isActionable: waiting 不可执行,confirmed/none 可执行', () => {
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now: Date.UTC(2026, 5, 22, 12, 0, 0), today: '2026-06-22', tz: 'UTC' };
  const item = { summary: '调研', description: '', repeat_rule: '' };
  const waiting = normalizeComments([{ content: `${SENT} ${MARK} 确认?`, created_at: '1000' }]);
  const confirmed = normalizeComments([
    { content: `${SENT} ${MARK} 确认?`, created_at: '1000' },
    { content: '好', created_at: '2000' },
  ]);
  assert.equal(isActionable(item, waiting, opts), false);
  assert.equal(isActionable(item, confirmed, opts), true);
  assert.equal(isActionable(item, [], opts), true);
});

test('isActionable: 重复任务当天已成功 → 不可执行;失败过 → 仍可执行', () => {
  const opts = { markers: ['[每日]'], sentinel: SENT, marker: MARK, doneMark: DONE, today: '2026-06-22', tz: 'UTC' };
  const item = { summary: '写周报 [每日]', description: '', repeat_rule: '' };
  const ms = Date.UTC(2026, 5, 22, 1, 0, 0);
  const done = normalizeComments([{ content: `${SENT} ${DONE} 已执行`, created_at: String(ms) }]);
  const failed = normalizeComments([{ content: `${SENT} ❌ 失败`, created_at: String(ms) }]);
  assert.equal(isActionable(item, done, opts), false);
  assert.equal(isActionable(item, failed, opts), true);
});
