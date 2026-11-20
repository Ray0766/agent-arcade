<p align="center"><img src="src/assets/brand/ribbon-simple-v1.png" width="96" alt="Agent Arcade 丝带标志" /></p>

# Agent Arcade

**在桌面上和 AI 搭档聊天。** 用自己的 API key 开始对话，随时换角色，也能查看和管理每位搭档记住的事。聊天记录和记忆保存在你的电脑上。Agent Arcade 以 AGPL-3.0 开源，API 调用由模型提供商计费。

[English](README.md) · [首次使用](docs/FIRST_RUN.md) · [验证记录](docs/VALIDATION.md)

现在可从公开 **preview.8** 源码体验 App 内聊天。下面的 **preview.61** 配图取自较新的本机 Mac 候选版。[从源码运行](#从源码运行)一节列出了两个版本的入口。

![鲸鱼娘的沉浸式夜间对话界面，显示关于周六去看海的演示对话](docs/images/preview61/companion-chat-zh.png)

*「陪伴 → 对话」的沉浸式布局，取自本机 Apple Silicon 验证包。对话、档案和记忆均为合成数据。[配图版本与来源](docs/README_MEDIA.md)。*

## 开始聊天

1. 按[从源码运行](#从源码运行)启动 App，打开 **陪伴 → 对话**。
2. 根据手上的 API key，选择对应的 Claude、GPT、DeepSeek、Gemini 或豆包。
3. 粘贴密钥，点击 **保存并开始聊天**，发出第一条消息。

![首用界面已选中 GPT，API key 输入框为空，下方是保存并开始聊天按钮](docs/images/preview61/first-run-zh.png)

App 内聊天只需对应提供商的 API key。请求直接发给该提供商，陪伴对话不会使用文件或终端工具。[提供商与渠道说明](docs/CHANNELS_AND_AI.md)。

## 切换搭档，查看和修改记忆

用搭档切换器换一位角色聊天，沿用当前 AI 提供商和密钥。每位角色有各自的 App 对话和记忆。需要分开用密钥时，可以另建搭档档案。已有 SillyTavern 角色卡时，可以在「角色」中导入 PNG 或 JSON，再选「用这个角色聊天」。[角色卡支持范围](docs/SILLYTAVERN_PARITY.md)。

![搭档切换器展开，显示当前档案和内置角色选择框](docs/images/preview61/companion-switcher-zh.png)

进入 **相处 → 记得的事**，可查看、添加、修改或遗忘 App 记忆。若同时显示渠道来源，选择 **App 记忆** 查看当前搭档的本机事实。修改或遗忘也会清理该角色近期 App 对话和自由笔记，避免旧内容再次进入上下文；其他角色和 QQ 记录保留。[App 对话与记忆](docs/DESKTOP_CHAT.md)。

![极简日间布局下的两条演示记忆，每条都有修改与忘记按钮](docs/images/preview61/memory-zh.png)

可以切换沉浸式、聊天应用式和极简工具式布局，选择日间、夜间或跟随系统，并让强调色跟随角色。[外观设置](docs/APPEARANCE.md)。

## 从源码运行

| 版本 | 使用入口 |
| --- | --- |
| **0.4.0-preview.8** 开发源码 | GitHub `main`。用下方固定提交体验 App 内对话、搭档切换和 App 记忆。 |
| **0.4.0-preview.61** 本机 Mac 候选版 | 本文配图所用版本，已在 Apple Silicon 上用隔离档案验证。目前没有公开可下载的 Mac 安装包。 |
| **0.3.0-preview.2** Windows 下载版 | [公开 Windows 预览版](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2)，使用[微信派活与观察器流程](docs/releases/0.3.0-preview.2.md)。 |

安装 Git 和 [Node.js 24.18+（24.x）](https://nodejs.org/)，在新目录运行以下命令，启动公开源码检查点。

```sh
git clone --branch main --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion
cd agent-arcade-companion
git checkout --detach e7b58508ffc79a108dc95f20685288ae3ca078d6
git rev-parse HEAD
npm ci
npm start
```

预期 HEAD 为 `e7b58508ffc79a108dc95f20685288ae3ca078d6`。若 Agent Arcade 已在运行，请先从应用菜单退出旧实例。[首次使用指南](docs/FIRST_RUN.md)。

## 本地数据与更新

数据默认保存在 `~/.agent-arcade/`，可用 `AGENT_ARCADE_HOME` 指定目录。未另设目录时，`npm start` 和 `npm run demo` 使用同一份数据。演示入口提供标了来源的「工作」观察器样例。API key 使用系统加密，聊天数据库可在本地读取。每次模型请求会把对话上下文发给你选择的提供商。[隐私与安全](SECURITY.md)。

切换版本前保留数据目录备份。Mac 凭据组件和首次系统授权属于配置它的那台 Mac。更新后若读不到以前的 key，可按文档恢复。[更新备份](docs/UPDATE_BACKUPS.md) · [凭据保留与恢复](docs/CREDENTIAL_RETENTION.md)。

## 可选功能

- **工作**可查看 Claude Code 会话事件、本地产物及 worktree 任务看板。任务交回后仍需验收。[任务看板](docs/TASK_BOARD.md)。
- **提醒**可按需启用日历、文件夹和订阅源。共享笔记与反思建议需主人批准。[陪伴功能](docs/COMPANION.md)。
- **渠道与语音**可单独设置。公开源码中的 QQ 接入使用自备的 OneBot 桥接。[渠道与 AI](docs/CHANNELS_AND_AI.md) · [语音设置](docs/VOICE_LOCAL_SETUP.md)。

### 本机 Mac 候选版的新界面

在「工作 → 渠道 → 设置 QQ 群聊」可以接入已有 OneBot 桥接，也可以为单独安装的 LLBot 准备配置。请使用搭档已加入的群，并确认主人和搭档的 QQ 账号互为好友。群内回复与主动消息分别设置。preview.61 的隔离验证覆盖了群内 @、引用回复，以及按角色和发言人区分的记忆更正、提醒改期和取消。[本机候选版范围](docs/CANDIDATE_STATUS.md#local-apple-silicon-preview61)。

![Mac 的 QQ 群聊设置，QQ 号为空，建议使用 OneBot 端口 3002](docs/images/preview61/mac-qq-zh.png)

## 验证到哪一步

preview.8 用真实 DeepSeek 检查了首条回复、切换搭档、退出重开后保留数据、手动记忆召回、搭档隔离和遗忘。preview.61 在 Apple Silicon 上用 QQ 桥接和模型替身完成了隔离安装包验证。该版的真实 QQ 登录与群消息收发、真实模型、另一台 Mac 首装、Intel、系统弹窗、中文输入法、休眠唤醒和外部用户试用仍待验收。[真实模型检查](docs/REAL_MEMORY_FLOW_20261116.md) · [本机候选版检查](docs/CANDIDATE_STATUS.md#local-apple-silicon-preview61) · [试用清单](docs/ADOPTION_TRIAL_KIT.md)。

## 参与开发

按锁文件安装依赖后，可运行 `npm test`、`npm run check`、`npm run check:first-run` 和 `npm run check:release`。[贡献指南](CONTRIBUTING.md) · [架构](docs/ARCHITECTURE.md) · [质量规范](docs/QUALITY_BRIEF.md)。

Agent Arcade 使用 [AGPL-3.0-only](LICENSE)，不设付费功能。已按 MIT 发布的旧版沿用[原许可证](LICENSE-MIT-HISTORICAL)。[第三方声明](THIRD_PARTY_NOTICES.md) · [SillyTavern 改编记录](src/vendor/sillytavern/README.md) · [配图与素材来源](docs/README_MEDIA.md)。
