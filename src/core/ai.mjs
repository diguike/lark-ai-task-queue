// core/ai.mjs — 调用 claude 做一次性推理(非交互),并从输出里提取 JSON。
// 用于 `larkaq config nl`:让 claude 把自然语言意图翻译成结构化配置改动。

import { spawnSync } from 'node:child_process';

const ENV = { ...process.env, LARK_CLI_NO_PROXY: '1' };

/**
 * 用 claude -p 跑一次提示词,返回助手输出文本。
 * 纯推理、不使用工具,因此无需 --dangerously-skip-permissions。
 * @param {string} prompt
 * @returns {string}
 */
export function askClaude(prompt) {
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], {
    encoding: 'utf8',
    env: ENV,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`claude 无法执行: ${r.error.message}(是否已安装?)`);
  if (r.status !== 0) {
    throw new Error(`claude 退出码 ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  }
  let env;
  try {
    env = JSON.parse(r.stdout);
  } catch {
    // 不是 JSON 信封,退回当作纯文本
    return r.stdout;
  }
  if (env.is_error) throw new Error(`claude 报错: ${env.result ?? env.error ?? '未知'}`);
  return typeof env.result === 'string' ? env.result : JSON.stringify(env.result);
}

/**
 * 从一段可能含散文/```围栏的文本里,提取第一个平衡的 JSON 对象并解析(纯函数)。
 * @param {string} text
 * @returns {any}
 */
export function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('未在输出里找到 JSON 对象');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('输出里的 JSON 不完整');
}
