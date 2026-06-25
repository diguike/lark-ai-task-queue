// commands/run.mjs — 跑一轮(headless),以及后台常驻的循环体。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, getConfig } from '../core/config.mjs';
import { acquireLock } from '../core/lock.mjs';
import { countActionable, pullQueue } from '../core/queue.mjs';
import { logLine } from '../core/logger.mjs';
import { notify } from '../core/notify.mjs';
import { runAgent, resolveEngine } from '../core/engine.mjs';
import { nowStamp, color } from '../util.mjs';

function buildPrompt() {
  const base = readFileSync(resolve(ROOT, 'prompts/run-queue.md'), 'utf8');
  return `${base}\n项目根目录: ${ROOT}。按上面步骤跑一轮:用 \`larkaq queue pull\` 拉队列,逐条处理(含异步确认/重复任务判型,调用 larkaq 的原子操作),回写飞书,写日志;最后按步骤 4 的 \`notify.when\` 与"实质活动"规则决定是否调用 \`larkaq notify\`(无实质活动则不推送,不要因为这句话就强行发)。`;
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
      logLine('no actionable tasks this round (skip executor)');
      // on_activity(默认)/off 空轮静默;always 才发一条"无待办"心跳——此时执行器没被
      // 唤起,只能由框架直接推送(notify() 内部仍受 when=off / channel 等闸门约束)。
      if (getConfig('notify.when', 'on_activity') === 'always') {
        await notify(`🤖 Lark AI Runner · 本轮无待办,队列为空(${nowStamp()})`);
      }
      console.log('无可处理任务,跳过执行器。');
      return 0;
    }

    // 唤起配置的 AI 执行器(默认 Claude Code,可配 Codex)。无人值守跳过权限确认,
    // 安全靠 run-queue.md 的闸门:高风险任务只评论 [AI-NEEDS-CONFIRM] 不执行。
    // 先解析引擎名一次(配置非法则在此抛错,不会进到 spawn),打印的与实际跑的同源。
    const engine = resolveEngine();
    console.log(`可处理任务数: ${n},唤起 ${engine}…`);
    const { cmd, result: r } = runAgent(buildPrompt(), ROOT, engine);
    if (r.error) throw new Error(`${cmd} 无法执行: ${r.error.message}(是否已安装?)`);
    if (r.signal) {
      logLine(`${engine} 被信号 ${r.signal} 终止`);
      console.error(color.red(`${engine} 被信号 ${r.signal} 终止`));
      return 1;
    }
    const code = r.status ?? 1; // 正常退出 status 是数字;异常时不要当成 0
    if (code !== 0) logLine(`${engine} 退出码 ${code}`);
    console.log(color.dim(`[${nowStamp()}] run 结束(${engine} exit=${code})`));
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
