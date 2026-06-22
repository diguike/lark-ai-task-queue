import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookTextPayload } from '../src/core/notify.mjs';

test('webhookTextPayload: 飞书自定义机器人 text 消息体', () => {
  assert.deepEqual(webhookTextPayload('hello'), {
    msg_type: 'text',
    content: { text: 'hello' },
  });
});
