import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCommand, SUPPORTED_ENGINES } from '../src/core/engine.mjs';
import { validateConfig } from '../src/core/config.mjs';

const ROOT = '/proj/root';
const PROMPT = '跑一轮队列';

test('SUPPORTED_ENGINES: 含 claude 与 codex', () => {
  assert.deepEqual([...SUPPORTED_ENGINES].sort(), ['claude', 'codex']);
});

test('buildAgentCommand: claude → -p + --add-dir + 跳过权限', () => {
  const { cmd, args } = buildAgentCommand('claude', PROMPT, ROOT);
  assert.equal(cmd, 'claude');
  assert.deepEqual(args, ['-p', PROMPT, '--add-dir', ROOT, '--dangerously-skip-permissions']);
});

test('buildAgentCommand: codex → exec + bypass sandbox + -C 工作目录,prompt 末位', () => {
  const { cmd, args } = buildAgentCommand('codex', PROMPT, ROOT);
  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', ROOT, PROMPT]);
  assert.equal(args[args.length - 1], PROMPT); // prompt 必须在末位
});

test('buildAgentCommand: 未知引擎抛错', () => {
  assert.throws(() => buildAgentCommand('gemini', PROMPT, ROOT), /未知 execution\.agent/);
});

test('validateConfig: execution.agent 仅接受 claude/codex', () => {
  assert.doesNotThrow(() => validateConfig('execution.agent', 'claude'));
  assert.doesNotThrow(() => validateConfig('execution.agent', 'codex'));
  assert.throws(() => validateConfig('execution.agent', 'gpt'), /claude\/codex/);
  assert.throws(() => validateConfig('execution.agent', ''), /claude\/codex/);
});
