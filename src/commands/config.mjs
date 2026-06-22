// commands/config.mjs — 查看与设置配置(config list / get / set)。

import { loadConfig, getConfig, setConfig } from '../core/config.mjs';
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

    default:
      throw new Error(`未知 config 子命令: ${sub}(可用 list/get/set)`);
  }
}
