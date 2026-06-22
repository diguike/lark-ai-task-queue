// cli.mjs — 命令分发。把 argv 派发到 commands/*,统一错误处理与退出码。

import { color } from './util.mjs';
import { cmdInstall } from './commands/install.mjs';
import { cmdDoctor } from './commands/doctor.mjs';
import { cmdConfig } from './commands/config.mjs';
import { cmdRun, cmdDaemonLoop } from './commands/run.mjs';
import { cmdStart, cmdStop, cmdStatus, cmdLogs } from './commands/daemon.mjs';
import * as agent from './commands/agent.mjs';

const HELP = `${color.bold('larkaq')} — 把飞书任务清单当作寄给 AI 的异步待办队列

${color.bold('用法:')} larkaq <命令> [参数]

${color.bold('上手:')}
  install              首次引导:检查依赖、生成配置、引导登录、发现 AI 清单
  doctor               体检:依赖 / 认证 / 配置 / 清单发现
  config list          打印当前配置(敏感值脱敏)
  config get <路径>     读单个配置项,如 config get notify.channel
  config set <路径> <值> 设置配置项,如 config set execution.max_tasks_per_run 5

${color.bold('运行:')}
  run [--dry-run]      跑一轮(锁 + 预筛 + 有活才唤起 claude;--dry-run 只预筛不执行)
  start                后台常驻(用户态,不进系统定时任务)
  stop                 停止后台常驻
  status               查看后台状态
  logs                 跟踪后台输出

${color.bold('给 AI 执行器的原子操作(一般由 prompts/run-queue.md 调用):')}
  queue pull                       拉未完成任务 JSON 数组
  confirm-state <task_guid>        异步确认状态机 → JSON
  is-recurring <summary> <desc> [rr]   是否重复任务(退出码 0=是)
  recurring-done <task_guid>       重复任务今天是否已干(退出码 0=已干)
  comment <task_guid> <内容>        给任务加评论
  complete <task_guid>             标记任务完成
  doc <xml>                        建飞书文档,输出分享 url
  log <消息>                        写一行本地日志
  notify <markdown>                发本轮飞书汇总

${color.dim('详见 README.md 与 DEPLOY.md。')}`;

const ROUTES = {
  install: (a) => cmdInstall(a),
  doctor: (a) => cmdDoctor(a),
  config: (a) => cmdConfig(a),
  run: (a) => cmdRun(a),
  start: () => cmdStart(),
  stop: () => cmdStop(),
  status: () => cmdStatus(),
  logs: () => cmdLogs(),
  _daemonLoop: () => cmdDaemonLoop(),
  '_daemon-loop': () => cmdDaemonLoop(),
  // 原子操作
  queue: (a) => agent.cmdQueue(a),
  'confirm-state': (a) => agent.cmdConfirmState(a),
  'is-recurring': (a) => agent.cmdIsRecurring(a),
  'recurring-done': (a) => agent.cmdRecurringDone(a),
  comment: (a) => agent.cmdComment(a),
  complete: (a) => agent.cmdComplete(a),
  doc: (a) => agent.cmdDoc(a),
  log: (a) => agent.cmdLog(a),
  notify: (a) => agent.cmdNotify(a),
};

export async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  const route = ROUTES[cmd];
  if (!route) {
    console.error(color.red(`未知命令: ${cmd}`));
    console.error('运行 `larkaq --help` 查看用法。');
    return 2;
  }
  try {
    const code = await route(args);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    console.error(color.red(`✗ ${err?.message ?? err}`));
    if (process.env.LARKAQ_DEBUG) console.error(err?.stack ?? '');
    return 1;
  }
}
