// core/schema.mjs — 可被用户/自然语言设置的配置项清单。
//
// 这是 `larkaq config nl` 喂给 claude 的"可改字段白名单",也用于校验 claude
// 给出的改动:只允许改这里列出的 path,其余一律拒绝(防止 AI 乱写内部字段)。

import { validateConfig } from './config.mjs';

/** @typedef {{path:string, type:string, desc:string, sensitive?:boolean}} ConfigField */

/** 用户可设置的配置项(不含 confirmation 哨兵/标记等会破坏状态机的内部项)。 */
export const CONFIG_SCHEMA = [
  { path: 'queue.tasklist_name_prefix', type: 'string', desc: '队列清单名前缀,清单名以此开头即入队' },
  { path: 'queue.tasklist_guids', type: 'string[]', desc: '强制白名单 guid;非空则忽略前缀只认这些' },
  { path: 'execution.agent', type: 'enum: claude|codex', desc: '无人值守执行队列用哪个编码代理(默认 claude,可选 codex)' },
  { path: 'execution.max_tasks_per_run', type: 'integer>0', desc: '每轮最多处理几条任务' },
  { path: 'execution.poll_interval_minutes', type: 'number>0', desc: 'larkaq start 后台轮询间隔(分钟)' },
  { path: 'execution.require_confirmation_for_risky', type: 'boolean', desc: '高风险任务(删除/外发/花钱)是否挂起等确认' },
  { path: 'execution.timezone', type: 'IANA 时区字符串或""', desc: '重复任务"每日"按哪个时区算,空=本地' },
  { path: 'recurring.markers', type: 'string[]', desc: '命中即视为重复任务的标记,如 ["[每日]","[daily]"]' },
  { path: 'output.create_lark_doc', type: 'boolean', desc: '产出是否建飞书文档' },
  { path: 'output.doc_folder_token', type: 'string', desc: '文档落到哪个云空间文件夹的 token,空=默认位置', sensitive: true },
  { path: 'output.mark_task_done_on_success', type: 'boolean', desc: '普通任务成功后是否标记完成' },
  { path: 'notify.channel', type: 'enum: off|bot|webhook', desc: '每轮汇总推送渠道' },
  { path: 'notify.when', type: 'enum: always|on_activity|off', desc: '何时推送:always=每轮都发;on_activity=仅本轮有实质活动(完成/等确认/失败/条件触发)才发(默认);off=从不' },
  { path: 'notify.webhook_url', type: 'string(url)', desc: '飞书自定义机器人 webhook 地址(channel=webhook 时用)', sensitive: true },
  { path: 'logging.local_log_dir', type: '项目内相对路径', desc: '本地日志目录' },
];

/** 允许设置的 path 集合。 */
export const SETTABLE_PATHS = new Set(CONFIG_SCHEMA.map((f) => f.path));

/** 渲染 schema 为给 claude 的清单文本。getCurrent(path) 提供脱敏后的当前值展示。 */
export function schemaLines(getCurrent) {
  return CONFIG_SCHEMA.map((f) => {
    const cur = getCurrent ? `,当前值=${getCurrent(f)}` : '';
    return `- ${f.path} (${f.type}):${f.desc}${cur}`;
  }).join('\n');
}

/**
 * 校验 claude 给出的改动(纯函数):只放行白名单内、且过 validateConfig 的项。
 * @param {{path?:string, value?:any, reason?:string}[]} changes
 * @returns {{ok:{path,value,reason}[], bad:{path,value,error}[]}}
 */
export function vetChanges(changes) {
  const ok = [];
  const bad = [];
  for (const ch of changes || []) {
    if (!ch || typeof ch.path !== 'string') {
      bad.push({ ...ch, error: '缺少 path' });
      continue;
    }
    if (!SETTABLE_PATHS.has(ch.path)) {
      bad.push({ ...ch, error: '不可设置的 path(不在白名单)' });
      continue;
    }
    try {
      validateConfig(ch.path, ch.value);
      ok.push({ path: ch.path, value: ch.value, reason: ch.reason });
    } catch (e) {
      bad.push({ ...ch, error: e.message });
    }
  }
  return { ok, bad };
}
