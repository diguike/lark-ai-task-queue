// core/engine.mjs — AI 执行器适配层。
//
// 队列由一个"编码代理 CLI"无人值守地执行:它读 run-queue.md 提示词,自己跑
// `larkaq` 原子操作、回写飞书、产出文档。默认用 Claude Code,可经 execution.agent
// 配置切到 Codex。两个引擎都要满足同样的契约:
//   1) 非交互/headless(没有人在旁边点确认);
//   2) 能执行 shell 命令并联网(larkaq → lark-cli → 飞书 API);
//   3) 跳过权限确认 —— 安全不靠引擎沙箱,而靠 run-queue.md 的高风险闸门
//      (删除/外发/花钱只评论 [AI-NEEDS-CONFIRM] 不执行)。

import { spawnSync } from 'node:child_process';
import { getConfig } from './config.mjs';

const ENV = { ...process.env, LARK_CLI_NO_PROXY: '1' };

// 各引擎的命令构造(纯,便于单测)。build(prompt, root) → 参数数组。
const ENGINES = {
  claude: {
    bin: 'claude',
    // -p headless;--add-dir 授权项目目录;--dangerously-skip-permissions 无人值守必须。
    build: (prompt, root) => ['-p', prompt, '--add-dir', root, '--dangerously-skip-permissions'],
  },
  codex: {
    bin: 'codex',
    // exec 非交互;--dangerously-bypass-approvals-and-sandbox 等价于 claude 跳过确认
    // (无人值守要能跑命令并联网调飞书,不能被沙箱挡住);-C 设工作目录;prompt 末位。
    build: (prompt, root) => [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      root,
      prompt,
    ],
  },
};

/** 支持的引擎名(也用于配置校验与文案)。 */
export const SUPPORTED_ENGINES = Object.keys(ENGINES);

/**
 * 构造引擎命令(纯函数)。
 * @param {string} engine 'claude' | 'codex'
 * @returns {{cmd:string, args:string[]}}
 * @throws 未知引擎时抛错
 */
export function buildAgentCommand(engine, prompt, root) {
  const e = ENGINES[engine];
  if (!e) throw new Error(`未知 execution.agent: ${engine}(支持 ${SUPPORTED_ENGINES.join(' / ')})`);
  return { cmd: e.bin, args: e.build(prompt, root) };
}

/** 读取并校验 execution.agent(默认 claude)。 */
export function resolveEngine() {
  const name = getConfig('execution.agent', 'claude');
  if (!ENGINES[name]) {
    throw new Error(`未知 execution.agent: ${name}(支持 ${SUPPORTED_ENGINES.join(' / ')})`);
  }
  return name;
}

/**
 * 唤起配置的 AI 执行器跑一轮(stdio 继承,交互输出直通终端)。
 * engine 可由调用方先 resolveEngine() 解析后传入,确保"打印的引擎"与"实际跑的引擎"
 * 是同一次解析结果(避免两次读配置间被外部修改导致诊断不一致)。
 * @returns {{engine:string, cmd:string, result: import('node:child_process').SpawnSyncReturns<Buffer>}}
 */
export function runAgent(prompt, root, engine = resolveEngine()) {
  const { cmd, args } = buildAgentCommand(engine, prompt, root);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: ENV });
  return { engine, cmd, result };
}
