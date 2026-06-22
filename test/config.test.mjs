import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// config.mjs 在 import 时按 RUNNER_ROOT 计算路径,故先建临时仓库再动态 import。
function setupRepo() {
  const root = mkdtempSync(resolve(tmpdir(), 'larkaq-'));
  mkdirSync(resolve(root, 'config'), { recursive: true });
  const cfg = {
    queue: { tasklist_name_prefix: 'AI', state_file: 'config/state.json' },
    execution: { max_tasks_per_run: 3, timezone: '' },
    notify: { channel: 'bot', user_open_id: '' },
  };
  writeFileSync(resolve(root, 'config/config.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(resolve(root, 'config/config.example.json'), JSON.stringify(cfg, null, 2));
  return root;
}

test('getConfig / setConfig: 读写与回落默认', async () => {
  const root = setupRepo();
  process.env.RUNNER_ROOT = root;
  const cfg = await import(`../src/core/config.mjs?case=getset`);

  assert.equal(cfg.getConfig('queue.tasklist_name_prefix'), 'AI');
  assert.equal(cfg.getConfig('notify.user_open_id', 'fallback'), 'fallback'); // 空字符串 → 默认
  assert.equal(cfg.getConfig('does.not.exist', 7), 7);

  cfg.setConfig('execution.max_tasks_per_run', 5);
  const persisted = JSON.parse(readFileSync(resolve(root, 'config/config.json'), 'utf8'));
  assert.equal(persisted.execution.max_tasks_per_run, 5);

  delete process.env.RUNNER_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test('configPath: config.json 优先,缺失回落 example', async () => {
  const root = setupRepo();
  rmSync(resolve(root, 'config/config.json'));
  process.env.RUNNER_ROOT = root;
  const cfg = await import(`../src/core/config.mjs?case=fallback`);
  assert.ok(cfg.configPath().endsWith('config.example.json'));
  assert.throws(() => cfg.setConfig('a.b', 1), /config\.json 不存在/);

  delete process.env.RUNNER_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test('validateConfig: 拦截非法值,放行未知键', async () => {
  const root = setupRepo();
  process.env.RUNNER_ROOT = root;
  const { validateConfig } = await import(`../src/core/config.mjs?case=validate`);

  assert.throws(() => validateConfig('execution.max_tasks_per_run', 0), /正整数/);
  assert.throws(() => validateConfig('execution.max_tasks_per_run', -3), /正整数/);
  assert.throws(() => validateConfig('execution.poll_interval_minutes', 0), /正数/);
  assert.throws(() => validateConfig('notify.channel', 'sms'), /off\/bot\/webhook/);
  assert.throws(() => validateConfig('execution.timezone', 'Mars/Phobos'), /非法时区/);
  assert.throws(() => validateConfig('queue.state_file', '/etc/passwd'), /相对路径/);
  assert.throws(() => validateConfig('queue.state_file', '../escape'), /相对路径/);

  // 合法值与未知键不抛
  assert.doesNotThrow(() => validateConfig('execution.max_tasks_per_run', 5));
  assert.doesNotThrow(() => validateConfig('execution.timezone', ''));
  assert.doesNotThrow(() => validateConfig('execution.timezone', 'Asia/Shanghai'));
  assert.doesNotThrow(() => validateConfig('notify.channel', 'webhook'));
  assert.doesNotThrow(() => validateConfig('some.unknown.key', 'whatever'));

  delete process.env.RUNNER_ROOT;
  rmSync(root, { recursive: true, force: true });
});
