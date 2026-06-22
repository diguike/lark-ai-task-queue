// util.mjs — 纯工具函数(无副作用,无项目状态)。

import { writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// 在 PATH 里查可执行文件(纯 Node,替代 shell `command -v`,不 shell out)。
export function which(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        /* 忽略不可访问路径 */
      }
    }
  }
  return null;
}

// 按点路径取值,支持 a.b、a.b.c、a[0].b、data.items 等。缺失返回 undefined。
export function dig(obj, path) {
  if (path == null || path === '' || path === '.') return obj;
  const tokens = String(path)
    .replace(/^\./, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((t) => t !== '');
  let cur = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    cur = cur[tok];
  }
  return cur;
}

// 按点路径写值(中间缺失的对象会补齐)。
export function setDeep(obj, path, value) {
  const tokens = String(path).replace(/^\./, '').split('.').filter((t) => t !== '');
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const k = tokens[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[tokens[tokens.length - 1]] = value;
}

// 原子写文件:先写临时文件再 rename,避免中途失败留下半截内容。
export function writeAtomic(file, content) {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

// 把 epoch 毫秒按指定时区格式化为 YYYY-MM-DD。tz 为空 → 本机本地时区。
export function localDate(ms, tz) {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat('en-CA', opts).format(new Date(ms)); // en-CA → YYYY-MM-DD
}

// 当前时间戳字符串 YYYY-MM-DD HH:MM:SS(指定时区或本地)。
export function nowStamp(tz) {
  const d = new Date();
  const opts = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', // 防止午夜出现 24:xx
  };
  if (tz) opts.timeZone = tz;
  const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// 解析「值」参数:能解析成 JSON 就用 JSON,否则当字符串(供 config set 用)。
export function coerceValue(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// 终端着色(无 TTY 或 NO_COLOR 时退化为无色)。
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  dim: wrap('2'),
  bold: wrap('1'),
};
