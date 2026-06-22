// commands/config.mjs — 查看与设置配置(config list / get / set / nl)。

import { loadConfig, getConfig, setConfig } from '../core/config.mjs';
import { schemaLines, vetChanges } from '../core/schema.mjs';
import { askClaude, extractJsonObject } from '../core/ai.mjs';
import { dig, coerceValue, color } from '../util.mjs';

// 展示时脱敏的键(点路径)。
const SENSITIVE = ['notify.webhook_url', 'notify.user_open_id', 'output.doc_folder_token'];

// 深拷贝后脱敏并去掉 _comment_* 注释键,用于 config list。
function presentable(cfg) {
  const clone = JSON.parse(JSON.stringify(cfg));
  for (const path of SENSITIVE) {
    const v = dig(clone, path);
    if (typeof v === 'string' && v !== '') {
      const parts = path.split('.');
      let cur = clone;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = '***';
    }
  }
  const strip = (o) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const k of Object.keys(o)) {
        if (k.startsWith('_comment')) delete o[k];
        else strip(o[k]);
      }
    }
  };
  strip(clone);
  return clone;
}

export function cmdConfig(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case 'list':
      console.log(JSON.stringify(presentable(loadConfig()), null, 2));
      return 0;

    case 'get': {
      const path = rest[0];
      if (!path) throw new Error('用法: larkaq config get <路径>');
      const v = getConfig(path);
      console.log(v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
      return 0;
    }

    case 'set': {
      const [path, value] = rest;
      if (!path || value === undefined) throw new Error('用法: larkaq config set <路径> <值>');
      setConfig(path, coerceValue(value));
      console.log(color.green(`已设置 ${path} = ${value}`));
      return 0;
    }

    case 'nl':
    case 'ai':
      return cmdConfigNl(rest);

    default:
      throw new Error(`未知 config 子命令: ${sub}(可用 list/get/set/nl)`);
  }
}

// 当前值的脱敏展示(供 schema 清单用):敏感项只显示 已设置/空。
function currentDisplay(field) {
  const v = getConfig(field.path);
  if (field.sensitive) return v ? '(已设置)' : '(空)';
  if (v === undefined) return '(未设置)';
  return typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
}

function buildNlPrompt(intent) {
  return `你是 lark-ai-task-queue 的配置助手。根据用户的自然语言意图,决定要修改哪些配置项。

可设置的配置项(只能改下面这些,path 必须与列出的完全一致):
${schemaLines(currentDisplay)}

用户意图:
"""${intent}"""

只输出一个 JSON 对象,不要任何解释、不要 markdown 代码块:
{"changes":[{"path":"<上面列出的 path 之一>","value":<符合该项类型的合法值>,"reason":"<一句中文说明为何这样改>"}],"notes":"<可选:无法满足的诉求或需用户注意的点;没有就留空字符串>"}

规则:
- 只改用户意图明确要求的项;拿不准就不要改,并在 notes 里说明。
- value 必须是 JSON 原生类型并符合该项的类型/允许值(布尔用 true/false,数字不要加引号,数组用 [])。
- 绝不发明不在清单里的 path。
- 若用户意图与任何可设置项都无关,changes 返回空数组并在 notes 说明。`;
}

/** config nl <自然语言…> [--dry-run] — 用 claude 把自然语言意图翻成配置改动并应用。 */
function cmdConfigNl(rest) {
  const dryRun = rest.includes('--dry-run');
  const intent = rest.filter((a) => a !== '--dry-run').join(' ').trim();
  if (!intent) throw new Error('用法: larkaq config nl "<自然语言意图>" [--dry-run]');

  console.log(color.dim('正在让 Claude 理解你的意图…'));
  const raw = askClaude(buildNlPrompt(intent));
  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    throw new Error(`无法解析 Claude 的输出:${e.message}\n原始输出:${raw.slice(0, 300)}`);
  }

  const { ok, bad } = vetChanges(parsed.changes);
  const notes = (parsed.notes || '').trim();

  if (ok.length === 0) {
    console.log(color.yellow('未识别到可应用的配置改动。'));
    if (notes) console.log(color.dim(`Claude 备注:${notes}`));
    for (const b of bad) console.log(color.red(`  ✗ ${b.path ?? '?'}: ${b.error}`));
    return bad.length ? 1 : 0;
  }

  console.log(color.bold(dryRun ? '\n将要修改(--dry-run,不写入):' : '\n应用配置改动:'));
  for (const ch of ok) {
    const before = getConfig(ch.path);
    const beforeStr = before === undefined ? '(未设置)' : JSON.stringify(before);
    if (!dryRun) setConfig(ch.path, ch.value);
    console.log(`  ${color.green('•')} ${ch.path}: ${color.dim(beforeStr)} → ${color.bold(JSON.stringify(ch.value))}`);
    if (ch.reason) console.log(color.dim(`      ${ch.reason}`));
    if (!dryRun) console.log(color.dim(`      还原: larkaq config set ${ch.path} '${beforeStr}'`));
  }
  for (const b of bad) console.log(color.yellow(`  ! 跳过 ${b.path ?? '?'}: ${b.error}`));
  if (notes) console.log(color.dim(`\nClaude 备注:${notes}`));
  if (dryRun) console.log(color.dim('\n(--dry-run 未写入;去掉它即应用)'));
  return 0;
}
