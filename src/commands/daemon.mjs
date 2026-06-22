// commands/daemon.mjs — 用户态后台常驻(start/stop/status/logs)。
// 不写系统 cron/launchd,就是一个你能随时关的后台 node 进程。

import { spawn } from 'node:child_process';
import {
  openSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, createReadStream, watchFile, statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, getConfig } from '../core/config.mjs';
import { writeAtomic, color } from '../util.mjs';

const LOGS = resolve(ROOT, 'logs');
const PIDFILE = resolve(LOGS, 'daemon.json');
const OUTLOG = resolve(LOGS, 'daemon.out');
const BIN = resolve(ROOT, 'bin/larkaq');
const ENV = { ...process.env, LARK_CLI_NO_PROXY: '1' };

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// best-effort:Linux 下读 /proc/<pid>/cmdline 确认确是本仓库的 daemon,降低 PID 复用误杀。
// 其它平台拿不到则不阻断(返回 true 表示"无法证伪")。
function looksLikeOurDaemon(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmd.includes('larkaq');
  } catch {
    return true;
  }
}

// 返回存活且确属本仓库的 daemon pid,否则 null。
function runningPid() {
  if (!existsSync(PIDFILE)) return null;
  let meta;
  try {
    meta = JSON.parse(readFileSync(PIDFILE, 'utf8'));
  } catch {
    return null;
  }
  if (!meta?.pid || meta.root !== ROOT) return null;
  if (!pidAlive(meta.pid) || !looksLikeOurDaemon(meta.pid)) return null;
  return meta.pid;
}

export function cmdStart() {
  const pid = runningPid();
  if (pid) {
    console.log(`已在运行 (pid ${pid})`);
    return 0;
  }
  mkdirSync(LOGS, { recursive: true });
  const out = openSync(OUTLOG, 'a');
  const child = spawn(process.execPath, [BIN, '_daemon-loop'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: ENV,
  });
  child.unref();
  writeAtomic(PIDFILE, JSON.stringify({ pid: child.pid, root: ROOT, at: Date.now() }) + '\n');
  const mins = getConfig('execution.poll_interval_minutes', 30);
  console.log(color.green(`已后台启动 (pid ${child.pid}),间隔 ${mins} 分钟。输出: ${OUTLOG}`));
  console.log('停止: larkaq stop   查看: larkaq logs');
  return 0;
}

export function cmdStop() {
  const pid = runningPid();
  if (!pid) {
    console.log('未在运行');
    rmSync(PIDFILE, { force: true });
    return 0;
  }
  try {
    process.kill(pid);
  } catch {
    /* 可能已退出 */
  }
  rmSync(PIDFILE, { force: true });
  console.log(`已停止 (pid ${pid})`);
  return 0;
}

export function cmdStatus() {
  const pid = runningPid();
  if (pid) {
    const mins = getConfig('execution.poll_interval_minutes', 30);
    console.log(color.green(`运行中 (pid ${pid}),间隔 ${mins} 分钟`));
  } else {
    console.log('未运行');
  }
  return 0;
}

// 纯 Node 实现 tail -f:先打印已有内容,再 watch 增量追加(跨平台,不 shell out)。
export function cmdLogs() {
  if (!existsSync(OUTLOG)) {
    console.log(`暂无日志文件: ${OUTLOG}`);
    return 0;
  }
  let offset = statSync(OUTLOG).size;
  createReadStream(OUTLOG, { encoding: 'utf8' }).pipe(process.stdout);
  watchFile(OUTLOG, { interval: 1000 }, (cur) => {
    if (cur.size < offset) offset = 0; // 文件被截断/轮转,从头读
    if (cur.size > offset) {
      createReadStream(OUTLOG, { start: offset, end: cur.size, encoding: 'utf8' }).pipe(process.stdout);
      offset = cur.size;
    }
  });
  return new Promise(() => {}); // 持续跟踪,直到用户 Ctrl-C
}
