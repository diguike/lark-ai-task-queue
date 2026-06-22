// commands/install.mjs — 首次引导。复制配置、检查依赖、给出登录与下一步指引。
// 原则:不改你的系统(不写 cron/launchd),只准备好本仓库内的配置。

import { copyFileSync, existsSync, chmodSync } from 'node:fs';
import { CONFIG_FILE, EXAMPLE_FILE } from '../core/config.mjs';
import { authStatus } from '../core/lark.mjs';
import { resolveTasklists } from '../core/queue.mjs';
import { dig, color, which } from '../util.mjs';

const has = (cmd) => which(cmd) !== null;

export function cmdInstall() {
  console.log(color.bold('Lark AI Task Queue · 安装引导\n'));

  // 1. 依赖
  console.log('1) 依赖检查');
  const missing = ['lark-cli', 'claude'].filter((c) => !has(c));
  if (missing.length) {
    console.log(color.red(`   ✗ 缺少:${missing.join(', ')}`));
    console.log('     - lark-cli:见飞书 lark-cli 文档安装(它是 node 脚本,会一并带来 node)');
    console.log('     - claude:npm i -g @anthropic-ai/claude-code');
  } else {
    console.log(color.green('   ✓ lark-cli / claude 均已安装'));
  }

  // 2. 配置文件
  console.log('2) 配置文件');
  if (existsSync(CONFIG_FILE)) {
    console.log(color.green('   ✓ config/config.json 已存在,跳过'));
  } else {
    copyFileSync(EXAMPLE_FILE, CONFIG_FILE);
    try {
      chmodSync(CONFIG_FILE, 0o600);
    } catch {
      /* Windows 等不支持 chmod,忽略 */
    }
    console.log(color.green('   ✓ 已从 example 生成 config/config.json(权限 600)'));
  }

  // 3. 飞书登录
  console.log('3) 飞书认证');
  const auth = authStatus();
  const userReady = dig(auth, 'identities.user.status') === 'ready';
  if (userReady) {
    console.log(color.green(`   ✓ user 身份 ready (${dig(auth, 'identities.user.userName') ?? '?'})`));
  } else {
    console.log(color.yellow('   ! 尚未登录飞书。请依次运行:'));
    console.log('     lark-cli config init');
    console.log(
      '     lark-cli auth login --scope "task:task:write task:tasklist:read task:comment:write docx:document:create"',
    );
  }

  // 4. 队列清单
  console.log('4) 队列清单发现');
  if (userReady) {
    try {
      const lists = resolveTasklists();
      if (lists.length) {
        for (const tl of lists) console.log(color.green(`   ✓ 命中清单:${tl.name}`));
      } else {
        console.log(color.yellow('   ! 未发现匹配前缀的清单 → 去飞书新建一个名字以 "AI" 开头的任务清单'));
      }
    } catch (err) {
      console.log(color.yellow(`   ! 清单发现失败:${err.message}`));
    }
  } else {
    console.log(color.dim('   - 登录后重新运行 larkaq install 或 larkaq doctor 即可发现清单'));
  }

  console.log('\n下一步:');
  console.log('  larkaq doctor          # 体检');
  console.log('  larkaq run --dry-run   # 看本轮会处理什么(不唤起 claude)');
  console.log('  larkaq run             # 真跑一轮');
  console.log('  larkaq start           # 后台常驻(或见 DEPLOY.md 装系统调度)');
  return 0;
}
