# First run / 首次使用

[简体中文](#简体中文) · [English](#english) · [版本与候选身份 / Candidate identities](CANDIDATE_STATUS.md)

## 简体中文

本轮优先路径：已有 API key 的中文用户，在桌面 App 内与角色进行文字对话。微信、QQ、项目目录、观察器 hooks、本机 Claude／Codex 登录都不是这条 API 路径的前提。

先选版本：

| 你拿到的版本 | 应使用的说明 |
| --- | --- |
| 公开 Windows `0.3.0-preview.2` | [该版的微信派活／观察器说明](releases/0.3.0-preview.2.md)。没有下面的 App 首用卡片。 |
| 开发源码 `codex/github-update-20261119`，固定 `e0deced…` | 使用下方完整提交与步骤。包版本 `0.4.0-preview.8`，尚未发布。 |
| 维护者的后续本地候选 | 本机安装包为 preview.8，构建源码 `8dd258c…`，固定源码包含其产品修复及后续证据文档；查[身份与验收摘要](CANDIDATE_STATUS.md)。包本身未公开下载。 |

**没有公开可下载的 Mac 候选包。** [公开发布页](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2)目前只有旧 Windows 版；本地包和 CI artifact 不等于公开下载。

安装 Git 和 Node.js **24.18+（24.x）**。固定源码的 engines 下限为 22.13，但完整测试要求 24.18+。在新目录运行下方共用命令，不要重置已有改动。核对完整 HEAD 后启动，在 **陪伴 → 对话** 选择 AI、粘贴该服务的 API key，点击 **保存并开始聊天**，再发出一条消息。API 调用由该服务收费，消费端订阅不等于 API 余额。

默认数据在 `~/.agent-arcade/`；`npm start` 和 `npm run demo` 共用这个位置。演示只提供标注的观察器样例，不是假模型对话，也不是隔离档案。已有数据时先退出旧 App 并自行保留数据备份，不要删除目录来排错。API key 使用操作系统加密；Mac 还依赖原钥匙串访问。固定源码包含备份、凭据恢复、角色隔离及完整退出修复。本机固定凭据组件需要单独配置和首次系统授权，不随源码携带主人的签名或授权；不能保证其他 Mac 首装或任意签名的跨包读取。遇到系统加密／凭据错误时保留原数据，参阅 [macOS 边界](MACOS.md)及[候选状态](CANDIDATE_STATUS.md)。

有角色卡可到“角色”导入 PNG／JSON，再选择“用这个角色聊天”。记忆和来源提醒可在后续设置；来源默认不启用。QQ 保留已有可选能力、不扩展；3D 后置。

本机 preview.8 已通过有界真实 DeepSeek 回复、手动记忆重开召回、搭档隔离及遗忘；[具体流程与限制](REAL_MEMORY_FLOW_20261116.md)。陌生人首次安装、更广记忆／提醒质量、另一台 Mac 的钥匙串授权、通知／文件选择弹窗、真实中文输入法、睡眠唤醒和真人日常使用仍未验收。已有假 key、模型替身或旧 QQ 测试不能替代这些门槛，见[验证摘要](VALIDATION.md#public-first-use-evidence--2026-11-14)。

## Exact remote source / 精确远端源码

Use a new directory / 使用新目录：

```sh
git clone --branch codex/github-update-20261119 --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion
cd agent-arcade-companion
git checkout --detach e0decedf41cac1b8217fd51b5711b925c45b0b60
git rev-parse HEAD
npm ci
npm start
```

Expected HEAD / 预期 HEAD：`e0decedf41cac1b8217fd51b5711b925c45b0b60`。
[Exact tree / 精确源码树](https://github.com/Ray0766/agent-arcade/tree/e0decedf41cac1b8217fd51b5711b925c45b0b60).
A plain clone selects older `main`; a matching version string does not identify later local repairs.
普通 clone 会取得较旧的 `main`；相同包版本号不能标识后续本地修复。

## English

The next acceptance path is desktop text companionship for Chinese-speaking users who already have an API key. WeChat, QQ, a project, observer hooks and local Claude/Codex sign-in are optional. Follow the version table and shared commands above: the public Windows `0.3.0-preview.2` has its own older task/observer workflow, while the pinned `0.4.0-preview.8` source includes the integrated repairs and verification documentation. The locally installed package has a separate build-source identity in [candidate status](CANDIDATE_STATUS.md). **No public Mac candidate download is available.**

Install Git and Node.js **24.18+ within 24.x** for the documented development/test route. The pinned package minimum is 22.13; that is not the complete-suite requirement. In a new folder, run the shared commands and verify the full HEAD. Open **Companion → Chat**, choose an AI, paste its API key and choose **Save and start chatting**, then send a message. The provider bills API use separately from consumer subscriptions.

The default data folder is `~/.agent-arcade/`. Normal startup and demo share it; demo supplies labelled observer examples, not a model conversation or an isolated profile. Close the older App and retain a data backup before using existing data; deleting that folder removes conversations and credentials. Keys use OS encryption, with Keychain access on Mac. The pinned source includes backup, credential recovery, persona isolation and complete-Quit repairs. The fixed local credential component needs separate setup and an initial OS grant; the owner's signing credentials/authorization are not included. Another Mac or arbitrary signer is not accepted. Keep the original files if credentials cannot be opened; consult [macOS notes](MACOS.md) and [candidate status](CANDIDATE_STATUS.md).

Import an existing PNG/JSON character card under Characters, then choose “Chat as this character”. Memory and source notices can be configured later; sources start disabled. QQ is optional and frozen for expansion; 3D is deferred.

Local preview.8 passes bounded real DeepSeek replies, manual-memory recall after restart, persona isolation and forgetting; see [the exact flow and limits](REAL_MEMORY_FLOW_20261116.md). First-stranger onboarding, broader memory/notice quality, another Mac's Keychain grant, notification/file-picker dialogs, real Chinese IME, sleep/wake and human daily use remain unaccepted. Fake keys, provider stand-ins and earlier QQ results do not accept this route. [Tracked evidence and limits](VALIDATION.md#public-first-use-evidence--2026-11-14).
