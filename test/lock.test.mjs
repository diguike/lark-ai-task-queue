import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// lock.mjs 在 import 时按 RUNNER_ROOT 计算锁路径,故先建临时根目录再动态 import。
// node --test 每个测试文件独立进程,这里设置的 env 只影响本文件。
const root = mkdtempSync(resolve(tmpdir(), 'larkaq-lock-'));
process.env.RUNNER_ROOT = root;
const { acquireLock } = await import('../src/core/lock.mjs');

const LOCK_DIR = resolve(root, 'logs/cron-run.lock');
const META = resolve(LOCK_DIR, 'owner.json');

function cleanLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

test('acquireLock: 取锁成功并能释放', () => {
  cleanLock();
  const lock = acquireLock();
  assert.equal(lock.ok, true);
  assert.ok(existsSync(LOCK_DIR));
  lock.release();
  assert.equal(existsSync(LOCK_DIR), false);
});

test('acquireLock: 已被(存活)持有者占用时拒绝', () => {
  cleanLock();
  const first = acquireLock();
  assert.equal(first.ok, true);
  const second = acquireLock(); // 同进程再取:owner=自己且存活 → 拒绝
  assert.equal(second.ok, false);
  assert.equal(second.owner.pid, process.pid);
  first.release();
});

test('acquireLock: 持有者已死 → 接管陈旧锁', () => {
  cleanLock();
  mkdirSync(LOCK_DIR, { recursive: true });
  writeFileSync(META, JSON.stringify({ pid: 2147483646, root, host: 'x', at: 'old' })); // 几乎不可能存活的 pid
  const lock = acquireLock();
  assert.equal(lock.ok, true);
  lock.release();
});

test('acquireLock: owner 读不到且未超 stale TTL → 不接管(防竞态双实例)', () => {
  cleanLock();
  mkdirSync(LOCK_DIR, { recursive: true }); // 只有目录,没有 owner.json,mtime 很新
  const lock = acquireLock();
  assert.equal(lock.ok, false); // 可能是别的进程刚 mkdir 还没写 owner,不能贸然接管
  cleanLock();
});

test('清理临时目录', () => {
  rmSync(root, { recursive: true, force: true });
});
