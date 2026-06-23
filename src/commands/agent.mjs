// commands/agent.mjs — 给 AI 执行器(prompts/run-queue.md)调用的原子操作。
// 每个都是一条 `larkaq <op>` 子命令,替代过去 source lib.sh 的 shell 助手。

import { pullQueue } from '../core/queue.mjs';
import { checkConfirmation, isRecurring, recurringDoneToday } from '../core/confirm.mjs';
import { addComment, completeTask, createDoc } from '../core/lark.mjs';
import { logLine } from '../core/logger.mjs';
import { notify } from '../core/notify.mjs';

function requireArg(value, name) {
  if (value === undefined || value === '') throw new Error(`缺少参数: ${name}`);
  return value;
}

/** queue pull — 输出未完成任务 JSON 数组。 */
export function cmdQueue(args) {
  if (args[0] !== 'pull') throw new Error('用法: larkaq queue pull');
  console.log(JSON.stringify(pullQueue()));
}

/** confirm-state <task_guid> — 异步确认状态机,输出 JSON。 */
export function cmdConfirmState(args) {
  console.log(JSON.stringify(checkConfirmation(requireArg(args[0], 'task_guid'))));
}

/** is-recurring <summary> <description> [repeat_rule] — 退出码 0=是。 */
export function cmdIsRecurring(args) {
  const [summary, description = '', rr = ''] = args;
  return isRecurring(requireArg(summary, 'summary'), description, rr) ? 0 : 1;
}

/** recurring-done <task_guid> [summary] [description] — 退出码 0=本周期内已干过。 */
export function cmdRecurringDone(args) {
  const [guid, summary = '', description = ''] = args;
  return recurringDoneToday(requireArg(guid, 'task_guid'), summary, description) ? 0 : 1;
}

/** comment <task_guid> <内容…> — 内容含空格未加引号时,自动合并剩余参数。 */
export function cmdComment(args) {
  const guid = requireArg(args[0], 'task_guid');
  const content = args.slice(1).join(' ');
  addComment(guid, requireArg(content, 'content'));
}

/** complete <task_guid> */
export function cmdComplete(args) {
  completeTask(requireArg(args[0], 'task_guid'));
}

/** doc <xml…> — 建飞书文档,输出分享 url。 */
export function cmdDoc(args) {
  console.log(createDoc(requireArg(args.join(' '), 'xml')) ?? '');
}

/** log <消息…> */
export function cmdLog(args) {
  logLine(requireArg(args.join(' '), 'message'));
}

/** notify <markdown…> */
export async function cmdNotify(args) {
  console.log(await notify(requireArg(args.join(' '), 'markdown')));
}
