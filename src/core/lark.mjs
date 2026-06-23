// core/lark.mjs — lark-cli 适配层(唯一 spawn lark-cli 的地方)。
//
// 所有调用都用 user 身份 + --json。把"调命令 + 校验返回码 + 解析 JSON"收敛到
// 一个 runLark(),其余高层操作只组织参数、提取字段,不再各自处理子进程细节。

import { spawnSync } from 'node:child_process';
import { getConfig } from './config.mjs';
import { dig } from '../util.mjs';

const ENV = { ...process.env, LARK_CLI_NO_PROXY: '1' };

/**
 * 调用 lark-cli 并返回解析后的 JSON。
 * @param {string[]} args lark-cli 子命令参数(不含 --as/--json,会自动补)
 * @param {{ identity?: 'user'|'bot' }} [opts]
 * @returns {any} 解析后的响应对象
 * @throws 子进程失败、输出非 JSON、或飞书返回 code!==0 时抛错
 */
export function runLark(args, { identity = 'user' } = {}) {
  const full = [...args, '--as', identity, '--json'];
  const r = spawnSync('lark-cli', full, { encoding: 'utf8', env: ENV, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw new Error(`lark-cli 无法执行: ${r.error.message}(是否已安装?)`);
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`lark-cli ${args[0] ?? ''} 退出码 ${r.status}: ${tail}`);
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    throw new Error(`lark-cli ${args[0] ?? ''} 输出非 JSON: ${(r.stdout || '').slice(0, 200)}`);
  }
  if (typeof data?.code === 'number' && data.code !== 0) {
    throw new Error(`飞书 API 错误 code=${data.code}: ${data.msg ?? ''}`);
  }
  return data;
}

/** 原生 OpenAPI GET。 */
export function apiGet(path, params) {
  return runLark(['api', 'GET', path, '--params', JSON.stringify(params)]);
}

/**
 * 翻页汇总(纯逻辑,runner 可注入便于测试)。反复调用 runner(buildArgs(pageToken))
 * 直到 data.has_more 为 false,汇总所有 data.items。封掉"只取第一页/前 100 条"的漏数风险。
 * @param {(args: string[]) => any} runner 执行一次请求并返回解析后的响应
 * @param {(pageToken: string|undefined) => string[]} buildArgs
 */
export function collectPaged(runner, buildArgs) {
  const items = [];
  let pageToken;
  let guard = 0;
  do {
    const data = runner(buildArgs(pageToken));
    items.push(...(dig(data, 'data.items') || []));
    pageToken = dig(data, 'data.has_more') ? dig(data, 'data.page_token') : undefined;
  } while (pageToken && ++guard < 100); // guard 防御异常的无限翻页
  return items;
}

/** 用真实 runLark 翻页拉取。 */
function runLarkPaged(buildArgs) {
  return collectPaged(runLark, buildArgs);
}

// ── 高层操作 ────────────────────────────────────────────────────────────────

/** 列出全部任务清单(翻页),返回原始 items(含 guid/name 等)。 */
export function listTasklists() {
  return runLarkPaged((pageToken) => {
    const params = { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) };
    return ['task', 'tasklists', 'list', '--params', JSON.stringify(params)];
  });
}

/**
 * 按关键词搜索任务清单(翻页),返回原始 items(含 guid/name)。
 * 与 `tasklists list` 互为双保险:实测 list 接口存在最终一致性窗口,
 * 偶发只回一个热子集(漏掉部分清单);搜索结果集更小、更贴合"找前缀清单"
 * 的意图,truncate 概率低。两者取并集去重,降低瞬时降级导致漏清单的概率。
 */
export function searchTasklists(query) {
  return runLarkPaged((pageToken) => [
    'task',
    '+tasklist-search',
    '--query',
    query,
    ...(pageToken ? ['--page-token', pageToken] : []),
  ]);
}

/** 取单个清单详情({guid,name,...})。用于白名单按 guid 反查清单名。 */
export function getTasklist(tasklistGuid) {
  const data = runLark([
    'task',
    'tasklists',
    'get',
    '--params',
    JSON.stringify({ tasklist_guid: tasklistGuid }),
  ]);
  return dig(data, 'data.tasklist') || {};
}

/** 列出某清单下未完成任务的原始 items(翻页)。 */
export function listPendingTasks(tasklistGuid) {
  return runLarkPaged((pageToken) => {
    const params = {
      tasklist_guid: tasklistGuid,
      completed: false,
      page_size: 100,
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    return ['task', 'tasklists', 'tasks', '--params', JSON.stringify(params)];
  });
}

/** 取单个任务详情(原始 task 对象)。 */
export function getTask(taskGuid) {
  const data = runLark(['task', 'tasks', 'get', '--params', JSON.stringify({ task_guid: taskGuid })]);
  return dig(data, 'data.task') || {};
}

/** 给任务加评论。 */
export function addComment(taskGuid, content) {
  return runLark(['task', '+comment', '--task-id', taskGuid, '--content', content]);
}

/** 标记任务完成。 */
export function completeTask(taskGuid) {
  return runLark(['task', '+complete', '--task-id', taskGuid]);
}

/** 列出任务评论的原始 items(翻页;确认状态机需要全部评论)。 */
export function listComments(taskGuid) {
  return runLarkPaged((pageToken) => {
    const params = {
      resource_type: 'task',
      resource_id: taskGuid,
      page_size: 100,
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    return ['api', 'GET', '/open-apis/task/v2/comments', '--params', JSON.stringify(params)];
  });
}

/** 建飞书文档,返回分享 url。 */
export function createDoc(xmlContent) {
  const folder = getConfig('output.doc_folder_token', '');
  const args = ['docs', '+create', '--api-version', 'v2', '--content', xmlContent];
  if (folder) args.push('--parent-token', folder);
  return dig(runLark(args), 'data.document.url');
}

/** 机器人私聊发 markdown 消息。 */
export function imSendMarkdown(userOpenId, markdown) {
  return runLark(['im', '+messages-send', '--user-id', userOpenId, '--markdown', markdown], {
    identity: 'bot',
  });
}

/** 查询 lark-cli 认证状态(原始对象)。 */
export function authStatus() {
  const r = spawnSync('lark-cli', ['auth', 'status'], { encoding: 'utf8', env: ENV });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}
