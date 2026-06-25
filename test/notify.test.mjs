import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// config.mjs 在 import 时按 RUNNER_ROOT 锁定路径,故先建临时仓库 + 设 RUNNER_ROOT,
// 再(顶层 await)动态 import notify。getConfig→loadConfig 每次都重读配置文件,
// 因此各用例只需重写 config.json 即可切换 notify 设置。
const ROOT = mkdtempSync(resolve(tmpdir(), 'larkaq-notify-'));
mkdirSync(resolve(ROOT, 'config'), { recursive: true });
process.env.RUNNER_ROOT = ROOT;
const { notify, webhookTextPayload } = await import('../src/core/notify.mjs');

function writeConfig(notifyCfg) {
  const cfg = { queue: {}, execution: {}, notify: notifyCfg };
  writeFileSync(resolve(ROOT, 'config/config.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(resolve(ROOT, 'config/config.example.json'), JSON.stringify(cfg, null, 2));
}

test('webhookTextPayload: 飞书自定义机器人 text 消息体', () => {
  assert.deepEqual(webhookTextPayload('hello'), {
    msg_type: 'text',
    content: { text: 'hello' },
  });
});

test('notify: when=off 框架级硬跳过(不碰渠道)', async () => {
  writeConfig({ when: 'off', channel: 'bot', user_open_id: 'ou_x' });
  assert.match(await notify('🤖 本轮小结'), /when=off/);
});

test('notify: when!=off 时放行到渠道逻辑(channel=off 再跳过)', async () => {
  writeConfig({ when: 'always', channel: 'off' });
  assert.match(await notify('🤖 本轮小结'), /channel=off/); // 过了 when 闸门,落到 channel=off
});

test('notify: when 缺省视为非 off,放行到渠道(默认 on_activity 不硬跳)', async () => {
  writeConfig({ channel: 'off' }); // 无 when 字段
  assert.match(await notify('🤖 本轮小结'), /channel=off/);
});

test('清理临时仓库', () => {
  delete process.env.RUNNER_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
});
