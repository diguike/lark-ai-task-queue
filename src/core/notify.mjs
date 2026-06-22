// core/notify.mjs — 每轮结束的飞书汇总推送。
// 渠道 off / bot / webhook,由 config.notify.channel 决定。webhook 用 Node 内置 fetch,
// 不依赖 curl。

import { getConfig } from './config.mjs';
import { imSendMarkdown } from './lark.mjs';

/** 飞书自定义机器人的 text 消息体(纯函数)。 */
export function webhookTextPayload(text) {
  return { msg_type: 'text', content: { text } };
}

/**
 * 发送本轮汇总。返回一句人类可读的结果说明。
 * **保证不抛错**(推送失败只返回提示),避免在错误处理路径里二次抛错掩盖原始错误。
 * @param {string} markdown
 */
export async function notify(markdown) {
  const channel = getConfig('notify.channel', 'bot');
  try {
    switch (channel) {
      case 'off':
        return 'notify: channel=off,跳过';

      case 'webhook': {
        const url = getConfig('notify.webhook_url', '');
        if (!url) return 'notify: channel=webhook 但未配 webhook_url,跳过';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookTextPayload(markdown)),
        });
        if (!res.ok) return `notify: webhook HTTP ${res.status}`;
        const body = await res.json().catch(() => ({}));
        return `notify: webhook code=${body.code ?? '?'} ${body.msg ?? ''}`.trim();
      }

      case 'bot':
      default: {
        const who = getConfig('notify.user_open_id', '');
        if (!who) return 'notify: channel=bot 但未配 user_open_id,跳过';
        const r = imSendMarkdown(who, markdown);
        return `notify: bot msg_id=${r?.data?.message_id ?? '?'}`;
      }
    }
  } catch (err) {
    return `notify failed (${channel}): ${err?.message ?? err}`;
  }
}
