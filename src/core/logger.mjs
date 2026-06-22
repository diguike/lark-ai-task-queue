// core/logger.mjs — 按天滚动的本地执行日志。

import { mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, getConfig, timezone } from './config.mjs';
import { localDate, nowStamp } from '../util.mjs';

/** 追加一行到 logs/YYYY-MM-DD.log,并回显到 stdout。 */
export function logLine(message) {
  const dir = resolve(ROOT, getConfig('logging.local_log_dir', 'logs'));
  mkdirSync(dir, { recursive: true });
  const day = localDate(Date.now(), timezone());
  const line = `${nowStamp(timezone())} | ${message}`;
  appendFileSync(resolve(dir, `${day}.log`), line + '\n');
  console.log(line);
}
