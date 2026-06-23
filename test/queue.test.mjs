import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTasklists, dedupByGuid, projectTask, selectActionable } from '../src/core/queue.mjs';
import { normalizeComments } from '../src/core/confirm.mjs';

const lists = [
  { guid: 'g1', name: 'AI 队列', extra: 1 },
  { guid: 'g2', name: 'ai todo' },
  { guid: 'g3', name: '私人清单' },
  { guid: 'g4', name: 'AIGC 灵感' },
];

test('filterTasklists: 按前缀大小写不敏感', () => {
  const got = filterTasklists(lists, 'AI', []);
  assert.deepEqual(
    got.map((x) => x.guid),
    ['g1', 'g2', 'g4'],
  );
  // 只保留 guid/name
  assert.deepEqual(Object.keys(got[0]).sort(), ['guid', 'name']);
});

test('filterTasklists: 白名单非空时忽略前缀', () => {
  const got = filterTasklists(lists, 'AI', ['g3', 'g4']);
  assert.deepEqual(
    got.map((x) => x.guid),
    ['g3', 'g4'],
  );
});

test('filterTasklists: 空输入安全', () => {
  assert.deepEqual(filterTasklists(undefined, 'AI', []), []);
  assert.deepEqual(filterTasklists([], 'AI', []), []);
});

test('dedupByGuid: 按 guid 去重保留首现,跳过空/缺 guid 项', () => {
  const got = dedupByGuid([
    { guid: 'a', name: '1' },
    { guid: 'a', name: '重复' },
    { guid: 'b', name: '2' },
    null,
    { name: '无 guid' },
  ]);
  assert.deepEqual(got, [
    { guid: 'a', name: '1' },
    { guid: 'b', name: '2' },
  ]);
  assert.deepEqual(dedupByGuid(undefined), []);
});

test('projectTask: 投影队列条目,补默认值并捕获开始时间', () => {
  const task = { guid: 't1', summary: '调研', description: 'd', url: 'http://x', repeat_rule: null };
  const row = projectTask(task, 'AI 队列', 'g1');
  assert.deepEqual(row, {
    tasklist_name: 'AI 队列',
    tasklist_guid: 'g1',
    guid: 't1',
    summary: '调研',
    description: 'd',
    url: 'http://x',
    repeat_rule: '',
    start_ts: 0,
    start_all_day: false,
  });
});

test('projectTask: 解析飞书开始时间字段', () => {
  const task = { guid: 't2', summary: 's', start: { timestamp: '1782000000000', is_all_day: true } };
  const row = projectTask(task, 'AI', 'g');
  assert.equal(row.start_ts, 1782000000000);
  assert.equal(row.start_all_day, true);
});

const SEL_OPTS = {
  markers: [],
  sentinel: '🤖',
  marker: '[AI-NEEDS-CONFIRM]',
  doneMark: '✅',
  now: Date.UTC(2026, 5, 22, 12, 0, 0),
  today: '2026-06-22',
  tz: 'UTC',
};
const waitingComments = normalizeComments([
  { content: '🤖 [AI-NEEDS-CONFIRM] 确认?', created_at: '1000' },
]);

test('selectActionable: 回归 —— 前 N 条都在等确认,后面可执行的仍能入选', () => {
  const entries = [
    { item: { guid: 'a', summary: 'A' }, comments: waitingComments },
    { item: { guid: 'b', summary: 'B' }, comments: waitingComments },
    { item: { guid: 'c', summary: 'C' }, comments: [] }, // 可执行
    { item: { guid: 'd', summary: 'D' }, comments: [] }, // 可执行
  ];
  const got = selectActionable(entries, SEL_OPTS, 1);
  assert.deepEqual(
    got.map((x) => x.guid),
    ['c'], // 不是被 waiting 的 a 占满名额
  );
});

test('selectActionable: 截断到 max(对可执行任务计数)', () => {
  const entries = [
    { item: { guid: 'a', summary: 'A' }, comments: [] },
    { item: { guid: 'b', summary: 'B' }, comments: waitingComments },
    { item: { guid: 'c', summary: 'C' }, comments: [] },
    { item: { guid: 'd', summary: 'D' }, comments: [] },
  ];
  const got = selectActionable(entries, SEL_OPTS, 2);
  assert.deepEqual(
    got.map((x) => x.guid),
    ['a', 'c'],
  );
});
