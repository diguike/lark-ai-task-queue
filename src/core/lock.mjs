// core/lock.mjs — 单实例锁(防重叠执行 → 防重复处理同一任务)。
//
// 用原子 mkdir 实现,跨平台、不依赖 flock。锁目录里记录持有者信息(pid/root/host/时间)。
// 接管陈旧锁时,先用原子 rename 把锁目录移到隔离名再重建,避免"读不到 owner 就 rm"的竞态
// 导致双实例;读不到 owner 的锁只在超过 stale TTL 后才接管(防御持有者刚 mkdir 未写 owner)。

import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { ROOT } from './config.mjs';
import { nowStamp } from '../util.mjs';

const LOCK_DIR = resolve(ROOT, 'logs/cron-run.lock');
const META = resolve(LOCK_DIR, 'owner.json');
const STALE_TTL_MS = 6 * 60 * 60 * 1000; // owner 不可读时,锁目录超过此年龄才视为陈旧

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // 存在但无权限发信号,视为存活
  }
}

function readOwner() {
  try {
    return JSON.parse(readFileSync(META, 'utf8'));
  } catch {
    return null;
  }
}

function lockAgeMs() {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs;
  } catch {
    return Infinity;
  }
}

function take() {
  mkdirSync(LOCK_DIR); // 已存在则抛 EEXIST(原子)
  writeFileSync(META, JSON.stringify({ pid: process.pid, root: ROOT, host: hostname(), at: nowStamp() }));
}

// 通过原子 rename 接管:把锁目录移到唯一隔离名再删,谁 rename 成功谁有权重建。
function reclaimAndTake() {
  const quarantine = `${LOCK_DIR}.stale.${process.pid}.${lockAgeMs() | 0}`;
  try {
    renameSync(LOCK_DIR, quarantine);
  } catch {
    return false; // 别的进程抢先接管或锁已消失
  }
  rmSync(quarantine, { recursive: true, force: true });
  try {
    take();
    return true;
  } catch {
    return false;
  }
}

/**
 * 尝试取锁。
 * @returns {{ ok: true, release: () => void } | { ok: false, owner: any }}
 */
export function acquireLock() {
  mkdirSync(resolve(ROOT, 'logs'), { recursive: true });
  const release = () => rmSync(LOCK_DIR, { recursive: true, force: true });
  try {
    take();
    return { ok: true, release };
  } catch {
    const owner = readOwner();
    if (owner) {
      // 同一仓库且持有者存活 → 上一轮仍在运行
      if (owner.root === ROOT && pidAlive(owner.pid)) return { ok: false, owner };
      // 持有者已死或属于别的 root → 陈旧锁,原子接管
      return reclaimAndTake() ? { ok: true, release } : { ok: false, owner };
    }
    // owner 读不到:可能是别的进程刚 mkdir 还没写 owner。只在超过 stale TTL 后才接管。
    if (existsSync(LOCK_DIR) && lockAgeMs() > STALE_TTL_MS) {
      return reclaimAndTake() ? { ok: true, release } : { ok: false, owner: null };
    }
    return { ok: false, owner: null };
  }
}
