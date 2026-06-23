// commands/doctor.mjs — 安装/配置体检。逐项告诉你缺什么。

import { existsSync } from 'node:fs';
import { CONFIG_FILE, getConfig } from '../core/config.mjs';
import { authStatus } from '../core/lark.mjs';
import { resolveTasklists } from '../core/queue.mjs';
import { SUPPORTED_ENGINES } from '../core/engine.mjs';
import { dig, color, which } from '../util.mjs';

export function cmdDoctor() {
  let ok = 0;
  let warn = 0;
  let bad = 0;
  const pass = (m) => {
    console.log(color.green(`  ✓ ${m}`));
    ok += 1;
  };
  const note = (m) => {
    console.log(color.yellow(`  ! ${m}`));
    warn += 1;
  };
  const fail = (m) => {
    console.log(color.red(`  ✗ ${m}`));
    bad += 1;
  };
  const has = (cmd) => which(cmd) !== null;

  console.log('── 1. 依赖 ──');
  // 核心依赖:lark-cli + 配置的执行引擎(claude 或 codex);node 随 lark-cli 必然存在。
  const engine = getConfig('execution.agent', 'claude');
  has('lark-cli') ? pass('lark-cli 已安装') : fail('lark-cli 缺失');
  if (!SUPPORTED_ENGINES.includes(engine)) {
    fail(`execution.agent=${engine} 非法(只能是 ${SUPPORTED_ENGINES.join('/')})`);
  } else {
    has(engine) ? pass(`${engine} 已安装(execution.agent)`) : fail(`${engine} 缺失(execution.agent=${engine})`);
  }
  pass(`node ${process.version}`);

  console.log('── 2. 飞书认证(lark-cli)──');
  const auth = authStatus();
  if (!auth) {
    fail('lark-cli auth status 无输出,先 lark-cli config init / auth login');
  } else {
    const ustat = dig(auth, 'identities.user.status') ?? 'none';
    const uname = dig(auth, 'identities.user.userName') ?? '?';
    if (ustat === 'ready') pass(`user 身份 ready (${uname})`);
    else if (dig(auth, 'identities.user.openId')) note(`user 已登录(${uname},状态 ${ustat},token 将自动续期)`);
    else fail(`user 身份未就绪(${ustat}),跑 lark-cli auth login --scope ...`);
    const bstat = dig(auth, 'identities.bot.status') ?? 'none';
    bstat === 'ready' ? pass('bot 身份 ready(推送用)') : note(`bot 身份未就绪(${bstat}),仅 channel=bot 推送需要`);
  }

  console.log('── 3. 配置 ──');
  if (existsSync(CONFIG_FILE)) {
    pass('config/config.json 存在');
    pass(`执行引擎 = ${engine}${engine === 'claude' ? '(默认)' : ''}`);
    const prefix = getConfig('queue.tasklist_name_prefix', '');
    prefix ? pass(`队列前缀 = "${prefix}"`) : note('未设 queue.tasklist_name_prefix');
    const ch = getConfig('notify.channel', 'bot');
    if (ch === 'off') pass('推送 channel=off(不推送)');
    else if (ch === 'bot') {
      getConfig('notify.user_open_id', '')
        ? pass('推送 channel=bot,已填 user_open_id')
        : note('channel=bot 但 user_open_id 为空 → 运行 `larkaq install` 可自动写入你本人');
    } else if (ch === 'webhook') {
      getConfig('notify.webhook_url', '')
        ? pass('推送 channel=webhook,已填 webhook_url')
        : note('channel=webhook 但 webhook_url 为空');
    } else note(`未知 notify.channel=${ch}`);
  } else {
    fail('config/config.json 不存在 → 运行 `larkaq install`');
  }

  console.log('── 4. 队列清单发现 ──');
  if (existsSync(CONFIG_FILE)) {
    try {
      const lists = resolveTasklists();
      if (lists.length === 0) {
        note('没发现匹配前缀的清单 → 去飞书建一个名字以该前缀开头的任务清单');
      } else {
        for (const tl of lists) pass(`命中清单:${tl.name}`);
        ok += 0;
      }
    } catch (err) {
      note(`跳过清单发现(${err.message})`);
    }
  } else {
    note('跳过(缺 config)');
  }

  console.log('');
  console.log(`── 体检结果:✓ ${ok}  ! ${warn}  ✗ ${bad} ──`);
  console.log(
    bad === 0
      ? '可以开跑:larkaq run(或 larkaq start)'
      : '先解决上面 ✗ 项再开跑。',
  );
  return 0;
}
