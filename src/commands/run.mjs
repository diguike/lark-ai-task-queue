// commands/run.mjs — 跑一轮(headless),以及后台常驻的循环体。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, getConfig } from '../core/config.mjs';
import { acquireLock } from '../core/lock.mjs';
import { countActionable, pullQueue } from '../core/queue.mjs';
import { logLine } from '../core/logger.mjs';
import { notify } from '../core/notify.mjs';
import { nowStamp, color } from '../util.mjs';

const ENV = { ...process.env, LARK_CLI_NO_PROXY: '1' };

function buildPrompt() {
  const base = readFileSync(resolve(ROOT, 'prompts/run-queue.md'), 'utf8');
  return `${base}\n项目根目录: ${ROOT}。按上面步骤跑一轮:用 \`larkaq queue pull\` 拉队列,逐条处理(含异步确认/重复任务判型,调用 larkaq 的原子操作),回写飞书,写日志,最后用 \`larkaq notify\` 发飞书汇总。`;
}

/**
 * 跑一轮。返回退出码。
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runRound({ dryRun = false } = {}) {
  console.log(color.dim(`[${nowStamp()}] run 开始${dryRun ? '(dry-run)' : ''}`));

  const lock = acquireLock();
  if (!lock.ok) {
    logLine(`previous round still running (pid ${lock.owner?.pid ?? '?'}), skip this tick`);
    console.log('上一轮仍在运行,跳过本轮。');
    return 0;
  }

  try {
    // 预筛:查飞书 + 解析。失败要明确报错,不能静默当成"没任务"而跳过。
    let n;
    try {
      n = countActionable();
    } catch (err) {
      logLine(`preflight failed: ${err.message}`);
      await notify(`🤖 ❌ Lark AI Runner 预筛失败:${err.message}。请运行 \`larkaq doctor\` 排查。`);
      console.error(color.red(`预筛失败:${err.message}`));
      return 1;
    }

    if (dryRun) {
      console.log(JSON.stringify(pullQueue(), null, 2));
      console.log(`可处理任务数: ${n}`);
      return 0;
    }

    if (n === 0) {
      logLine('no actionable tasks this round (skip claude)');
      console.log('无可处理任务,跳过 claude。');
      return 0;
    }

    console.log(`可处理任务数: ${n},唤起 claude…`);
    // --dangerously-skip-permissions:headless 无人值守必须(没人点确认)。
    // 安全靠 run-queue.md 的闸门:高风险任务只评论 [AI-NEEDS-CONFIRM] 不执行。
    const r = spawnSync(
      'claude',
      ['-p', buildPrompt(), '--add-dir', ROOT, '--dangerously-skip-permissions'],
      { stdio: 'inherit', env: ENV },
    );
    if (r.error) throw new Error(`claude 无法执行: ${r.error.message}(是否已安装?)`);
    if (r.signal) {
      logLine(`claude 被信号 ${r.signal} 终止`);
      console.error(color.red(`claude 被信号 ${r.signal} 终止`));
      return 1;
    }
    const code = r.status ?? 1; // 正常退出 status 是数字;异常时不要当成 0
    if (code !== 0) logLine(`claude 退出码 ${code}`);
    console.log(color.dim(`[${nowStamp()}] run 结束(claude exit=${code})`));
    return code;
  } finally {
    lock.release();
  }
}

/** run 子命令入口。 */
export async function cmdRun(args) {
  return runRound({ dryRun: args.includes('--dry-run') });
}

/** 后台常驻循环体(由 daemon start 拉起的内部命令)。 */
export async function cmdDaemonLoop() {
  const intervalMs = getConfig('execution.poll_interval_minutes', 30) * 60 * 1000;
  console.log(`后台循环启动,间隔 ${intervalMs / 60000} 分钟。`);
  for (;;) {
    try {
      await runRound();
    } catch (err) {
      console.error(`本轮异常: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
