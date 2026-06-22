import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPaged } from '../src/core/lark.mjs';

test('collectPaged: 单页(无 has_more)只请求一次', () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { data: { items: [{ id: 1 }, { id: 2 }], has_more: false } };
  };
  const items = collectPaged(runner, () => ['x']);
  assert.equal(calls, 1);
  assert.deepEqual(items.map((x) => x.id), [1, 2]);
});

test('collectPaged: 多页翻页,按 page_token 串联并汇总', () => {
  const pages = {
    undefined: { data: { items: [{ id: 1 }], has_more: true, page_token: 'p2' } },
    p2: { data: { items: [{ id: 2 }], has_more: true, page_token: 'p3' } },
    p3: { data: { items: [{ id: 3 }], has_more: false } },
  };
  const seen = [];
  const runner = (args) => {
    const token = args[0]; // buildArgs 把 token 放在 args[0]
    seen.push(token);
    return pages[String(token)];
  };
  const items = collectPaged(runner, (pageToken) => [pageToken]);
  assert.deepEqual(items.map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(seen, [undefined, 'p2', 'p3']); // 确实翻了三页
});

test('collectPaged: 空 items 安全', () => {
  const items = collectPaged(() => ({ data: {} }), () => ['x']);
  assert.deepEqual(items, []);
});

test('collectPaged: has_more 为真但无 page_token 时停止(防御)', () => {
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { data: { items: [{ id: calls }], has_more: true } }; // 没有 page_token
  };
  const items = collectPaged(runner, () => ['x']);
  assert.equal(calls, 1); // 不会无限翻
  assert.deepEqual(items.map((x) => x.id), [1]);
});
