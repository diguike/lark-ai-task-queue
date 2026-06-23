import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComments,
  evaluateConfirmation,
  recurringDoneOn,
  lastRecurringSuccessAt,
  parseEveryInterval,
  parseActiveWindow,
  withinActiveWindow,
  parseCronField,
  parseCronExpr,
  parseSchedule,
  cronMatches,
  cronDue,
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

test('lastRecurringSuccessAt: 取最近一条成功评论时间戳,无则 0', () => {
  const c = normalizeComments([
    { content: `${SENT} ${DONE} 第一次`, created_at: '1000' },
    { content: `${SENT} ❌ 失败`, created_at: '2000' },
    { content: `${SENT} ${DONE} 第二次`, created_at: '3000' },
  ]);
  assert.equal(lastRecurringSuccessAt(c, SENT, MARK, DONE), 3000);
  assert.equal(lastRecurringSuccessAt([], SENT, MARK, DONE), 0);
  // 确认请求(含 marker)不算成功
  const confirm = normalizeComments([{ content: `${SENT} ${MARK} ${DONE}?`, created_at: '5000' }]);
  assert.equal(lastRecurringSuccessAt(confirm, SENT, MARK, DONE), 0);
});

test('parseEveryInterval: 解析 [每N分钟/小时/天],无参数标记返回 null', () => {
  assert.equal(parseEveryInterval('回消息 [每30分钟]'), 30 * 60_000);
  assert.equal(parseEveryInterval('巡检 [每1小时]'), 3_600_000);
  assert.equal(parseEveryInterval('巡检 [每 2 小时]'), 2 * 3_600_000); // 容空格
  assert.equal(parseEveryInterval('对账 [每2天]'), 2 * 86_400_000);
  assert.equal(parseEveryInterval('缩写 [每30m]'), 30 * 60_000);
  assert.equal(parseEveryInterval('缩写 [每2h]'), 2 * 3_600_000);
  assert.equal(parseEveryInterval('写周报 [每日]'), null); // 无数字 → 自然日,不在此列
  assert.equal(parseEveryInterval('[每0分钟]'), null); // 非正数无效
  assert.equal(parseEveryInterval('普通任务'), null);
});

test('parseActiveWindow / withinActiveWindow: 时段窗口(含跨午夜)', () => {
  const day = parseActiveWindow('回消息 [09:00-22:00]');
  assert.deepEqual(day, { start: 540, end: 1320 });
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 10, 0), day, 'UTC'), true); // 10:00 在内
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 8, 0), day, 'UTC'), false); // 08:00 早于窗口
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 22, 0), day, 'UTC'), false); // 22:00 含头不含尾
  // 跨午夜窗口 [22:00-02:00]
  const night = parseActiveWindow('值守 [22:00-02:00]');
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 23, 0), night, 'UTC'), true); // 23:00 在内
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 1, 0), night, 'UTC'), true); // 01:00 在内
  assert.equal(withinActiveWindow(Date.UTC(2026, 5, 22, 12, 0), night, 'UTC'), false); // 中午不在
  // 无窗口 → 永远视为在内
  assert.equal(withinActiveWindow(Date.now(), null, 'UTC'), true);
  assert.equal(parseActiveWindow('无时段'), null);
  assert.equal(parseActiveWindow('[25:00-26:00]'), null); // 非法时分
});

test('parseCronField: *、单值、范围、步长、列表、非法', () => {
  assert.deepEqual([...parseCronField('*', 0, 5).set], [0, 1, 2, 3, 4, 5]);
  assert.equal(parseCronField('*', 0, 5).star, true);
  assert.deepEqual([...parseCronField('3', 0, 5).set], [3]);
  assert.deepEqual([...parseCronField('1-3', 0, 9).set], [1, 2, 3]);
  assert.deepEqual([...parseCronField('*/2', 0, 6).set], [0, 2, 4, 6]);
  assert.deepEqual([...parseCronField('0-6/3', 0, 9).set], [0, 3, 6]);
  assert.deepEqual([...parseCronField('1,3,5', 0, 9).set], [1, 3, 5]);
  assert.equal(parseCronField('3', 0, 5).star, false);
  assert.equal(parseCronField('99', 0, 59), null); // 越界
  assert.equal(parseCronField('5-1', 0, 9), null); // 反序
  assert.equal(parseCronField('a', 0, 9), null); // 非数字
  assert.equal(parseCronField('*/0', 0, 9), null); // 0 步长
});

test('parseCronExpr: 5 字段解析,字段数不对或非法返回 null', () => {
  const s = parseCronExpr('*/30 9-22 * * *');
  assert.ok(s);
  assert.equal(s.domStar, true);
  assert.equal(s.dowStar, true);
  assert.ok(s.minute.has(0) && s.minute.has(30) && !s.minute.has(15));
  assert.ok(s.hour.has(9) && s.hour.has(22) && !s.hour.has(8));
  assert.equal(parseCronExpr('* * * *'), null); // 4 字段
  assert.equal(parseCronExpr('* * * * * *'), null); // 6 字段
  assert.equal(parseCronExpr('99 * * * *'), null); // 非法分钟
  // dow 7 归一为周日 0
  assert.ok(parseCronExpr('0 0 * * 7').dow.has(0));
});

test('parseSchedule: [cron: …] 优先,[每日 HH:MM] 语法糖,[每日](无时间)不匹配', () => {
  assert.ok(parseSchedule('巡检 [cron: 0 9 * * 1-5]'));
  const daily = parseSchedule('写周报 [每日 09:30]');
  assert.ok(daily);
  assert.ok(daily.minute.has(30) && daily.hour.has(9));
  assert.ok(parseSchedule('日报 [每天 18:00]'));
  assert.equal(parseSchedule('写周报 [每日]'), null); // 无时间 → 走自然日
  assert.equal(parseSchedule('[每日 25:00]'), null); // 非法时分
  assert.equal(parseSchedule('普通任务'), null);
});

test('cronMatches: 工作日 9 点匹配,周末/非整点不匹配', () => {
  const s = parseCronExpr('0 9 * * 1-5');
  // 2026-06-22 是周一
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 22, 9, 0), 'UTC'), true); // 周一 09:00
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 22, 9, 30), 'UTC'), false); // 非整点
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 20, 9, 0), 'UTC'), false); // 周六
});

test('cronMatches: 日与周都受限 → 取并集(Vixie 语义)', () => {
  // 每月 1 号 或 周一 的 00:00
  const s = parseCronExpr('0 0 1 * 1');
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 1, 0, 0), 'UTC'), true); // 6/1 周一,两者都中
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 8, 0, 0), 'UTC'), true); // 6/8 周一(非1号)→ 并集命中
  assert.equal(cronMatches(s, Date.UTC(2026, 6, 1, 0, 0), 'UTC'), true); // 7/1(非周一)→ 并集命中
  assert.equal(cronMatches(s, Date.UTC(2026, 5, 9, 0, 0), 'UTC'), false); // 6/9 周二非1号 → 都不中
});

test('cronDue: 首次立即到期;跨过匹配点到期;未跨过不到期', () => {
  const s = parseCronExpr('0 9 * * *'); // 每天 09:00
  const tz = 'UTC';
  assert.equal(cronDue(s, 0, Date.UTC(2026, 5, 22, 23, 0), tz), true); // 从没跑过 → 立即
  // 上次成功昨天 09:05,现在今天 09:10 → 跨过了今天 09:00 → 到期
  assert.equal(
    cronDue(s, Date.UTC(2026, 5, 21, 9, 5), Date.UTC(2026, 5, 22, 9, 10), tz),
    true,
  );
  // 上次成功今天 09:05,现在今天 12:00 → 今天 09:00 在上次成功之前,无新匹配点 → 不到期
  assert.equal(
    cronDue(s, Date.UTC(2026, 5, 22, 9, 5), Date.UTC(2026, 5, 22, 12, 0), tz),
    false,
  );
  // 停跑超 35 天 → 保守到期
  assert.equal(cronDue(s, Date.UTC(2026, 3, 1, 9, 0), Date.UTC(2026, 5, 22, 9, 0), tz), true);
});

test('isRecurringText: cron / [每日 HH:MM] 也算重复任务', () => {
  assert.equal(isRecurringText([], '巡检 [cron: */30 * * * *]', ''), true);
  assert.equal(isRecurringText([], '周报 [每日 09:00]', ''), true);
  assert.equal(isRecurringText([], '一次性', ''), false);
});

test('isActionable: cron 调度按匹配点放行;时段/确认闸门仍优先', () => {
  const tz = 'UTC';
  const base = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, today: '2026-06-22', tz };
  const item = { summary: '巡检 [cron: 0 9 * * *]', description: '', repeat_rule: '' };
  // 今天 09:10,从没跑过 → 可执行
  assert.equal(isActionable(item, [], { ...base, now: Date.UTC(2026, 5, 22, 9, 10) }), true);
  // 今天 09:05 已成功,现在 09:10 同一触发点 → 不可执行
  const done = normalizeComments([{ content: `${SENT} ${DONE} ok`, created_at: String(Date.UTC(2026, 5, 22, 9, 5)) }]);
  assert.equal(isActionable(item, done, { ...base, now: Date.UTC(2026, 5, 22, 9, 10) }), false);
  // 次日 09:10 → 跨过新触发点 → 又可执行
  assert.equal(isActionable(item, done, { ...base, now: Date.UTC(2026, 5, 23, 9, 10) }), true);
});

test('isRecurringText: 写错的频率标记仍算重复任务(不被当一次性划掉)', () => {
  assert.equal(isRecurringText([], '任务 [cron: 99 * * * *]', ''), true); // 非法 cron
  assert.equal(isRecurringText([], '任务 [每日 25:00]', ''), true); // 非法定点
  assert.equal(isRecurringText([], '任务 [每0分钟]', ''), true); // 非法间隔
});

test('isActionable: 声明了频率标记但全写错 → 保守不执行(停队列)', () => {
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now: Date.UTC(2026, 5, 22, 12, 0), today: '2026-06-22', tz: 'UTC' };
  assert.equal(isActionable({ summary: '坏cron [cron: 99 * * * *]', description: '', repeat_rule: '' }, [], opts), false);
  assert.equal(isActionable({ summary: '坏定点 [每日 25:00]', description: '', repeat_rule: '' }, [], opts), false);
  assert.equal(isActionable({ summary: '坏间隔 [每0分钟]', description: '', repeat_rule: '' }, [], opts), false);
});

test('isActionable: 声明了窗口但写错 → 保守不执行', () => {
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now: Date.UTC(2026, 5, 22, 12, 0), today: '2026-06-22', tz: 'UTC' };
  assert.equal(isActionable({ summary: '回消息 [每30分钟] [25:00-26:00]', description: '', repeat_rule: '' }, [], opts), false);
});

test('cronDue: 命中点须落在活跃窗口内才算到期(窗口外命中点不补跑)', () => {
  const s = parseCronExpr('0 3 * * *'); // 每天 03:00
  const win = parseActiveWindow('[09:00-22:00]');
  const tz = 'UTC';
  // 昨天 03:05 成功,现在今天 09:10:今天 03:00 命中点在窗口外 → 不到期(不在 09 点补跑)
  assert.equal(
    cronDue(s, Date.UTC(2026, 5, 21, 3, 5), Date.UTC(2026, 5, 22, 9, 10), tz, win),
    false,
  );
  // 同样配置但命中点在窗口内([09:00] cron)→ 到期
  const s2 = parseCronExpr('0 9 * * *');
  assert.equal(
    cronDue(s2, Date.UTC(2026, 5, 21, 9, 5), Date.UTC(2026, 5, 22, 9, 10), tz, win),
    true,
  );
});

test('isActionable: cron 命中点在窗口外永不补跑', () => {
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now: Date.UTC(2026, 5, 22, 9, 0), today: '2026-06-22', tz: 'UTC' };
  const item = { summary: '矛盾 [cron: 0 3 * * *] [09:00-22:00]', description: '', repeat_rule: '' };
  const done = normalizeComments([{ content: `${SENT} ${DONE} ok`, created_at: String(Date.UTC(2026, 5, 21, 3, 5)) }]);
  assert.equal(isActionable(item, done, opts), false); // 09:00 不补跑 03:00 命中点
});

test('isRecurringText: 飞书重复规则优先', () => {
  assert.equal(isRecurringText([], 'x', '{"freq":"DAILY"}'), true);
  assert.equal(isRecurringText([], 'x', 'null'), false);
  assert.equal(isRecurringText([], 'x', ''), false);
});

test('isRecurringText: 间隔标记也算重复任务(做完不划掉)', () => {
  assert.equal(isRecurringText([], '回消息 [每30分钟]', ''), true);
  assert.equal(isRecurringText([], '一次性任务', ''), false);
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

test('isActionable: 滚动间隔 [每30分钟] —— 未满间隔不跑,满了再跑(跨午夜不受自然日影响)', () => {
  const now = Date.UTC(2026, 5, 22, 12, 0, 0);
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, now, today: '2026-06-22', tz: 'UTC' };
  const item = { summary: '回未读消息 [每30分钟]', description: '', repeat_rule: '' };
  const ranAt = (minAgo) =>
    normalizeComments([{ content: `${SENT} ${DONE} 已执行`, created_at: String(now - minAgo * 60_000) }]);
  assert.equal(isActionable(item, ranAt(20), opts), false); // 20 分钟前跑过 → 未满
  assert.equal(isActionable(item, ranAt(35), opts), true); // 35 分钟前 → 已满
  assert.equal(isActionable(item, [], opts), true); // 从没跑过 → 可执行
  // 自然日同一天也不挡(滚动语义):午夜后第一次满间隔即可跑
  assert.equal(isActionable(item, ranAt(31), opts), true);
});

test('isActionable: 活跃时段窗口外 → 不可执行(即便到了间隔)', () => {
  const opts = { markers: [], sentinel: SENT, marker: MARK, doneMark: DONE, today: '2026-06-22', tz: 'UTC' };
  const item = { summary: '回消息 [每30分钟] [09:00-22:00]', description: '', repeat_rule: '' };
  const inside = { ...opts, now: Date.UTC(2026, 5, 22, 10, 0, 0) }; // 10:00 窗口内
  const outside = { ...opts, now: Date.UTC(2026, 5, 22, 3, 0, 0) }; // 03:00 窗口外
  assert.equal(isActionable(item, [], inside), true);
  assert.equal(isActionable(item, [], outside), false);
});
