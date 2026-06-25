// core/config.mjs — 配置与项目路径。
//
// 配置优先读 config/config.json,缺失时回落到 config/config.example.json,
// 因此 doctor/help 等命令在用户尚未建 config.json 时也能跑。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dig, setDeep, writeAtomic } from '../util.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** 项目根目录。可用 RUNNER_ROOT 环境变量显式覆盖(调度器场景有用)。 */
export const ROOT = process.env.RUNNER_ROOT || resolve(here, '../..');

export const CONFIG_FILE = resolve(ROOT, 'config/config.json');
export const EXAMPLE_FILE = resolve(ROOT, 'config/config.example.json');

/** 当前生效的配置文件路径(config.json 优先,否则 example)。 */
export function configPath() {
  return existsSync(CONFIG_FILE) ? CONFIG_FILE : EXAMPLE_FILE;
}

/** 读取并解析当前生效的配置。 */
export function loadConfig() {
  return JSON.parse(readFileSync(configPath(), 'utf8'));
}

/**
 * 取配置项(点路径)。缺失或空字符串时返回 fallback。
 * @param {string} path 形如 'queue.tasklist_name_prefix'
 */
export function getConfig(path, fallback = undefined) {
  const v = dig(loadConfig(), path);
  if (v === undefined || v === null || v === '') return fallback;
  return v;
}

/**
 * 校验已知配置键的取值(纯函数,非法即抛错)。未知键放行。
 * 防止把队列搞坏的明显错误值(负数、未知渠道、绝对路径越界等)。
 */
export function validateConfig(path, value) {
  const isPosInt = (v) => Number.isInteger(v) && v > 0;
  const isSafeRelPath = (v) =>
    typeof v === 'string' && v !== '' && !v.startsWith('/') && !v.split('/').includes('..');
  switch (path) {
    case 'execution.max_tasks_per_run':
      if (!isPosInt(value)) throw new Error('max_tasks_per_run 必须是正整数');
      break;
    case 'execution.poll_interval_minutes':
      if (!(typeof value === 'number' && value > 0)) throw new Error('poll_interval_minutes 必须是正数');
      break;
    case 'notify.channel':
      if (!['off', 'bot', 'webhook'].includes(value)) throw new Error("notify.channel 只能是 off/bot/webhook");
      break;
    case 'notify.when':
      if (!['always', 'on_activity', 'off'].includes(value)) throw new Error('notify.when 只能是 always/on_activity/off');
      break;
    case 'execution.agent':
      // 与 core/engine.mjs 的 SUPPORTED_ENGINES 保持一致(此处硬编码以避免 config↔engine 循环依赖)。
      if (!['claude', 'codex'].includes(value)) throw new Error('execution.agent 只能是 claude/codex');
      break;
    case 'execution.timezone':
      if (value !== '') {
        try {
          new Intl.DateTimeFormat('en-CA', { timeZone: value });
        } catch {
          throw new Error(`非法时区: ${value}(示例 Asia/Shanghai)`);
        }
      }
      break;
    case 'queue.state_file':
    case 'logging.local_log_dir':
      if (!isSafeRelPath(value)) throw new Error(`${path} 必须是项目内相对路径(不能以 / 开头或含 ..)`);
      break;
    default:
      break; // 未知键放行
  }
}

/** 写配置项到 config.json(原子写)。仅允许写真实配置文件,不写 example。 */
export function setConfig(path, value) {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`config/config.json 不存在,先运行 \`larkaq install\` 或从 example 复制`);
  }
  validateConfig(path, value);
  const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  setDeep(cfg, path, value);
  writeAtomic(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

/** 解析到的清单缓存文件路径(state.json)。 */
export function statePath() {
  return resolve(ROOT, getConfig('queue.state_file', 'config/state.json'));
}

/** AI 评论哨兵(区分人机评论),默认 🤖。 */
export const sentinel = () => getConfig('confirmation.ai_sentinel', '🤖');

/** 需人工确认标记,默认 [AI-NEEDS-CONFIRM]。 */
export const confirmMarker = () => getConfig('confirmation.needs_confirm_marker', '[AI-NEEDS-CONFIRM]');

/** AI 成功结果标记(用于判定重复任务今天是否已干过),默认 ✅。 */
export const successMark = () => getConfig('confirmation.ai_success_mark', '✅');

/** 计算"每日/今天"用的时区。空 = 进程本地时区。 */
export const timezone = () => getConfig('execution.timezone', '') || undefined;
