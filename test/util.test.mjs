import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dig, setDeep, localDate, nowStamp, coerceValue, which } from '../src/util.mjs';

test('dig: 点路径与数组下标', () => {
  const obj = { a: { b: [{ c: 1 }, { c: 2 }] }, x: 'y' };
  assert.equal(dig(obj, 'x'), 'y');
  assert.equal(dig(obj, 'a.b[1].c'), 2);
  assert.equal(dig(obj, 'a.b.0.c'), 1);
  assert.equal(dig(obj, '.a.b'), obj.a.b);
  assert.equal(dig(obj, 'a.missing.deep'), undefined);
  assert.equal(dig(obj, ''), obj);
});

test('setDeep: 补齐中间对象', () => {
  const obj = {};
  setDeep(obj, 'a.b.c', 5);
  assert.deepEqual(obj, { a: { b: { c: 5 } } });
  setDeep(obj, 'a.b.c', 9);
  assert.equal(obj.a.b.c, 9);
});

test('localDate: 按时区把毫秒格式化为 YYYY-MM-DD', () => {
  // 2026-06-22T16:30:00Z → 东京(UTC+9)已是 23 日,洛杉矶(UTC-7)仍是 22 日
  const ms = Date.UTC(2026, 5, 22, 16, 30, 0);
  assert.equal(localDate(ms, 'Asia/Tokyo'), '2026-06-23');
  assert.equal(localDate(ms, 'America/Los_Angeles'), '2026-06-22');
  assert.match(localDate(ms), /^\d{4}-\d{2}-\d{2}$/);
});

test('coerceValue: 能解析 JSON 就用 JSON,否则按字符串', () => {
  assert.equal(coerceValue('5'), 5);
  assert.equal(coerceValue('true'), true);
  assert.deepEqual(coerceValue('[]'), []);
  assert.equal(coerceValue('bot'), 'bot');
  assert.equal(coerceValue('AI 队列'), 'AI 队列');
});

test('nowStamp: 格式 YYYY-MM-DD HH:MM:SS,午夜不出现 24:xx', () => {
  assert.match(nowStamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(nowStamp('Asia/Shanghai'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // 上海 00:30(= UTC 16:30 前一日)小时段必须是 00 而不是 24
  assert.doesNotMatch(nowStamp('Asia/Shanghai'), / 24:/);
});

test('which: 能找到 node,找不到子虚乌有的命令', () => {
  assert.ok(which('node'));
  assert.equal(which('definitely-not-a-real-cmd-xyz'), null);
});
