# 安全策略 / Security Policy

## 报告漏洞 / Reporting a Vulnerability

请**不要**在公开 issue 里提交安全问题。请通过 GitHub 的
[Security Advisories](https://github.com/diguike/lark-ai-task-queue/security/advisories/new)
私密报告,或直接邮件联系仓库维护者(见 GitHub 主页)。

我们会在合理时间内回应并协调修复与披露。

*Please do not file security issues publicly. Report privately via GitHub Security Advisories
or by emailing the maintainer.*

## 支持的版本 / Supported Versions

本项目处于活跃开发期,仅 `main` 分支的最新提交受支持。

## 设计边界 / Security Design Notes

这个工具的本质决定了几条需要使用者知情的安全边界:

- **`--dangerously-skip-permissions`**:headless 无人值守跑 `claude -p` 时**必须**带此参数(没有人在场点确认)。
  安全不靠它,而靠 `prompts/run-queue.md` 的**高风险闸门**:涉及删除 / 外发 / 花钱的任务只会评论
  `🤖 [AI-NEEDS-CONFIRM] …` 挂起等你确认,**不会自动执行**。请勿自行放宽这条闸门。
- **凭证不入仓库**:飞书 appSecret 由 `lark-cli` 存于 `~/.lark-cli`;`config/config.json`、
  `config/state.json`、`logs/` 均被 `.gitignore` 排除。`larkaq config list` 展示时对
  `webhook_url` / `user_open_id` / `doc_folder_token` 脱敏。
- **队列隔离**:只处理名字以约定前缀(默认 `AI`)开头的清单,绝不读写你其它飞书任务。
- **供应链**:本工具**零三方 npm 依赖**(仅运行期外部 CLI `lark-cli` / `claude`),攻击面极小。
  贡献时请勿引入运行时依赖。

## 部署者自查清单 / Operator Checklist

- 授权 `lark-cli` 时按**最小权限**开通 scope(见 README)。
- 确认 `config/config.json` 权限为 `600`(`install` 会自动设置)。
- 公网服务器部署时,确认 `--dangerously-skip-permissions` 的闸门未被改动。
