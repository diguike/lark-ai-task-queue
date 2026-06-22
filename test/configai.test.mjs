import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject } from '../src/core/ai.mjs';
import { vetChanges, SETTABLE_PATHS } from '../src/core/schema.mjs';

test('extractJsonObject: 纯 JSON', () => {
  assert.deepEqual(extractJsonObject('{"a":1,"b":[2,3]}'), { a: 1, b: [2, 3] });
});

test('extractJsonObject: 容忍 ```json 围栏与前后散文', () => {
  const text = '好的,这是改动:\n```json\n{"changes":[{"path":"notify.channel","value":"webhook"}]}\n```\n以上。';
  const obj = extractJsonObject(text);
  assert.equal(obj.changes[0].path, 'notify.channel');
});

test('extractJsonObject: 字符串里的花括号不影响平衡解析', () => {
  const obj = extractJsonObject('prefix {"note":"用 {curly} 测试","ok":true} suffix');
  assert.equal(obj.note, '用 {curly} 测试');
  assert.equal(obj.ok, true);
});

test('extractJsonObject: 找不到 JSON 抛错', () => {
  assert.throws(() => extractJsonObject('完全没有大括号'), /未在输出里找到 JSON/);
});

test('vetChanges: 合法改动放行', () => {
  const { ok, bad } = vetChanges([
    { path: 'notify.channel', value: 'webhook', reason: 'x' },
    { path: 'execution.max_tasks_per_run', value: 5, reason: 'y' },
  ]);
  assert.equal(ok.length, 2);
  assert.equal(bad.length, 0);
});

test('vetChanges: 拒绝白名单外的 path(防 AI 乱写内部字段)', () => {
  const { ok, bad } = vetChanges([
    { path: 'confirmation.ai_sentinel', value: '@' }, // 不在白名单
    { path: 'queue.state_file', value: '/etc/passwd' }, // 不在白名单
  ]);
  assert.equal(ok.length, 0);
  assert.equal(bad.length, 2);
  assert.match(bad[0].error, /不可设置/);
});

test('vetChanges: 拒绝非法值(过 validateConfig 闸门)', () => {
  const { ok, bad } = vetChanges([
    { path: 'notify.channel', value: 'sms' },
    { path: 'execution.max_tasks_per_run', value: -1 },
    { path: 'execution.timezone', value: 'Mars/Phobos' },
  ]);
  assert.equal(ok.length, 0);
  assert.equal(bad.length, 3);
});

test('vetChanges: 缺 path / 空输入安全', () => {
  assert.deepEqual(vetChanges(undefined), { ok: [], bad: [] });
  const { bad } = vetChanges([{ value: 1 }]);
  assert.match(bad[0].error, /缺少 path/);
});

test('SETTABLE_PATHS: 内部敏感项确实不在白名单', () => {
  assert.ok(SETTABLE_PATHS.has('notify.channel'));
  assert.ok(!SETTABLE_PATHS.has('confirmation.ai_sentinel'));
  assert.ok(!SETTABLE_PATHS.has('queue.state_file'));
});
