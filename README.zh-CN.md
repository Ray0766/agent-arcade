<p align="center"><img src="docs/banner.svg" alt="Agent Arcade" /></p>

# Agent Arcade

[English](README.md) · [构建状态](https://github.com/Ray0766/agent-arcade/actions) · [公开 Windows 预览版 0.3.0-preview.2](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2) · [制作主题](docs/THEMES.md)

Agent Arcade 是一个开源的桌面应用，用来在自己的电脑上和 AI 角色聊天。它以 AGPL-3.0 发布，不设收费功能；应用在本机运行，聊天记录和记忆保存在本机，模型由你自带的一个 API key 调用（Claude、GPT、DeepSeek、Gemini 或豆包任选其一）。这里描述的是 **0.4.0-preview.1 开发源码**，与可下载的旧 Windows 版不同。请先按下表选择版本。

**当前本地整合候选：**`0.4.0-preview.2` 已整合 75 路径修复快照及八个准备提交，尚未发布。新包身份与本轮检查见[整合报告](docs/MACOS_INTEGRATION_20261115.md)。下表继续区分较早的公开版本与固定远端源码。

## 先选对版本

公开可获得版本已于 **2026-11-15** 只读核对：

| 版本 | 实际能拿到什么 | 首次使用路径 |
| --- | --- | --- |
| **公开版 0.3.0-preview.2** | [Windows 可执行文件、校验和、依赖锁文件](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2)，属于旧版微信派活／观察器，沿用 MIT 许可。 | 按[该版本说明](docs/releases/0.3.0-preview.2.md)配对微信 ClawBot 和任务后端；它**没有**下文的 App 首用密钥卡片。 |
| **开发源码 0.4.0-preview.1** | 远端 `codex/companion-nine`，固定基线 `3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`，AGPL-3.0-only，**尚未发布**。 | 按[从源码运行](#从源码运行)取精确提交，再按[第一次使用](#第一次使用)操作。 |
| **基线之后的本地候选修复** | 另行冻结的未提交 App／macOS 修复，以及本地 ad-hoc 签名、未公证的 arm64 包。 | 不在远端固定基线或公开版中；本说明／采用准备分支也未整合这些修复。见[候选身份摘要](docs/CANDIDATE_STATUS.md)与[验证摘要](docs/VALIDATION.md#public-first-use-evidence--2026-11-14)。 |

**目前没有公开可下载的 Mac 候选包。** 本地包和 Actions artifact 不等于公开发布。Mac 用户目前需要从源码运行；构建与平台边界见 [macOS 说明](docs/MACOS.md)。不带分支的普通 clone 会取得较旧的默认 `main`。

本轮优先验证**已有 API key 的中文桌面文本陪伴**。QQ 不扩展，3D 角色留作后续；既有工作区与渠道能力继续保留。中英文共用[首次使用指南](docs/FIRST_RUN.md)。

## 开发源码能做什么

- **和角色聊天。**保存一个 API key 后，在“对话”页直接和内置角色聊。每个角色有自己的聊天记录，以及你可以查看、改正和删除的记忆。
- **角色库。**导入 SillyTavern 角色卡（PNG 或 JSON，V1／V2／V3），带开场白与备选开场白、世界书、作者注释、预设、正则脚本，以及消息的编辑、重新生成和分支。卡里的文字只当资料用，卡内脚本和扩展不会运行。逐项对照见 [SillyTavern 功能对照](docs/SILLYTAVERN_PARITY.md)。
- **群聊。**把角色库里的 2 到 8 个角色放进同一段 App 对话。
- **笔记与反思。**笔记是本机文件夹里的 Markdown 页面。角色只能提出逐行修改，由你批准后才写入；反思把你不止一次纠正它的地方整理成规则候选，同样要你批准才生效。
- **提醒。**让应用留意日历（.ics 文件或订阅链接）、文件夹和 RSS／网页更新，用桌面通知提醒，或交给角色转告。默认不留意任何来源。
- **界面。**沉浸、聊天、简洁三种布局；强调色可以跟随当前角色，也可以固定；日间／夜间；中文／English。
- **可选的聊天渠道。**微信 ClawBot、QQ、飞书等，见下方[可选：聊天渠道](#可选聊天渠道)。不连接任何渠道也能使用上面的功能。
- **工作区。**查看本机 Claude Code 会话的状态（需要你自己安装观察器钩子），以及任务看板：每个后台 Claude Code 任务在自己的 git worktree 里运行，交回后由你验收。

## 现在的状态

App 优先路径仍是开发候选，请区分证据层级：

- **组件／自动检查与隔离窗口：**角色卡、世界书、预设、采样、消息操作、流式、群聊、笔记／反思、来源提醒、布局和任务看板。测试可以使用真实文件、SQLite 和 Electron 窗口，同时仍使用模型替身；这不是真实模型或真人验收。
- **早期版本的有界实用记录：**QQ 陪伴回复（Claude／GPT／DeepSeek）、部分本机 Claude 派活与观察器事件，不能代替新 App 优先路径的验收。见[九项验收表](docs/COMPANION_ACCEPTANCE.md)与[已跟踪验证摘要](docs/VALIDATION.md#public-first-use-evidence--2026-11-14)。
- **macOS：**源码启动、假 key 的系统加密保存、模型替身对话和 ad-hoc 打包有有界证据。后续本地候选另有保留既有真实档案的维护记录，但本轮未重跑，也未调用模型。版本归属见[候选身份摘要](docs/CANDIDATE_STATUS.md)。真实模型、钥匙串／通知等系统弹窗、真实中文输入法及真人日常使用仍未验收。
- **真实提供商缺口：**Gemini／豆包的真实凭据和调用，以及 App 优先路径的记忆／提醒质量与完整首条真实回复，仍未验收。

公开证据见 [docs/VALIDATION.md](docs/VALIDATION.md)。`WORK_LOG.md`、原始 `outputs/` 回执和本地包路径是私有／本机维护记录，不是首次 clone 需要的文件或公开下载入口。固定源码不包含后续未提交修复。

## 第一次使用

**适用于下文的开发源码与新档案。**中英文共用[首次使用指南](docs/FIRST_RUN.md)；公开 Windows 0.3.0-preview.2 请按版本表中的旧版说明。

1. 运行 `npm start`，进入 **陪伴 → 对话 / Companion → Chat**，看到 AI 密钥卡片。
2. 选一个 AI：Claude、GPT、DeepSeek、Gemini 或豆包。
3. 粘贴这个服务的 API key，点击 **保存并开始聊天 / Save and start chatting**。密钥用操作系统的加密保存在本机；调用按该服务计费。
4. 开始聊天。App 内对话的消息会发给你选的 AI 服务；默认的 App 对话不需要 Agent Arcade 服务器；可选的 Messenger 和远程管理路线需要另行部署服务，见对应说明。

已经有角色卡：到“角色”页点“导入角色卡…”，打开导入的角色，再点“用这个角色聊天”。

微信、QQ 等渠道和“工作”区都可以以后再设置，也可以一直不用。

## 数据放在哪里

- 默认在用户目录下的 `~/.agent-arcade/`（Windows 上是 `C:\Users\<用户名>\.agent-arcade\`）；设置环境变量 `AGENT_ARCADE_HOME` 可以换到别处。里面有配置、聊天记录与记忆（SQLite）、角色库、笔记和已保存的凭据。
- API key 与聊天令牌用操作系统的加密保存；观察器数据是普通 JSON，不加密。
- 删除这个目录会把角色、记忆和凭据一起删掉。更细的说明见[隐私与开源](#隐私与开源)。

## 从源码运行

需要 Git；建议安装 [Node.js 24.18+（24.x）](https://nodejs.org/)，与完整测试要求一致。固定基线的 package engines 下限仍为 22.13，这不代表完整测试也只需该版本。请使用**新目录**，不要切换或重置已有未提交改动的 checkout。以下 detached checkout 固定远端基线，不会取得之后的分支变动或维护者本地修复。

```sh
git clone --branch codex/companion-nine --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion
cd agent-arcade-companion
git checkout --detach 3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4
git rev-parse HEAD
npm ci
npm start
```

`git rev-parse HEAD` 应输出 `3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`。[精确源码树](https://github.com/Ray0766/agent-arcade/tree/3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4)的包版本为 `0.4.0-preview.1`，含 App 首用卡片；版本号和构建成功都不等于已经发布。

- `npm start` 执行 `electron .`：启动应用本身，使用上面的数据目录。
- `npm run demo` 执行 `electron . --demo`：同一个应用，只是“工作 › 会话”页显示内置的示例会话（与真实观测分开）；演示状态下不发桌面通知，不加载提醒的数据源，也不运行定时反思。它用的仍是同一个数据目录，不是隔离的试用环境。
- 应用只允许一个实例，启动前请先关掉已经在运行的那个。
- `npm ci` 不会下载语音模型；可选的本机语音见[语音设置](docs/VOICE_LOCAL_SETUP.md)。
- 测试与检查命令见[隐私与开源](#隐私与开源)一节末尾。

## 可选：聊天渠道

不连接任何渠道也能使用 App 内对话。下面是把角色接到微信、QQ 等聊天软件，以及用聊天消息派活的既有说明；这些内容比上面的部分更早写成，范围和验证记录以各自链接的文档为准。

**QQ 的现状：**普通 QQ 通过你自备的非官方 NapCat／OneBot 组件桥接。NapCat 上游仓库在 2026-11-12 被清空为只剩 README、不再发布版本（2026-11-13 经 GitHub API 核对），所以应用内下载该组件已经不能成功。QQ 因此只是给已经装有该组件的人保留的可选能力，不再扩展。Agent Arcade 不包含也不使用 NapCat 源码，见[第三方说明](THIRD_PARTY_NOTICES.md)。

接入 QQ 后，每位角色使用独立登录的 QQ 账号，与主人持续对话，保留可编辑记忆，并可开启主动联系、约定回访和公开日记。角色与 AI 提供商分开选择。陪伴聊天不开放文件或终端工具；派活保留为独立模式。全账号自主操作、普通个人微信和朋友圈尚未实现。[陪伴设置与边界](docs/COMPANION.md)。

**真实进展，2026-11-05：**橘娘／Claude API、龙娘／GPT API、鲸鱼娘／DeepSeek 均已通过主人 QQ 的实际聊天，并在一个应用内同时运行。约定回访、记忆纠正与遗忘及重启后回忆、短气泡、原生角色卡、连续消息合并、三账号隔离与重连，已有范围明确的真实流程通过。一篇 QQ 空间动态已发布、读回并由主人看到；应用重启后的新草稿延续了此前主题。这些陪伴聊天证据不代表对应提供商的派活或文件工具流程也已验收。[九项验收表](docs/COMPANION_ACCEPTANCE.md)。

**九项任务尚未全部完成。**空间非主人可见范围、已知剩余气泡队列的停止，仍需真实验收。免按键的真人说话打断按用户决定暂缓，仍未验收。测试中也发生过 QQ 登录失效；一次重连成功不保证持续在线。桌面语音现可选本机 **Qwen ASR + GPT-SoVITS**，Windows 语音作为明确可选的备用方案。在修正后的本地构建中，用户已确认一次手动录音得到准确文字，并听到温柔女声回复；独立核对的诊断导出也记录了预览、确认和完整播放，未出现错误。这只验收本次手动流程，不代表免按键打断、重复运行稳定性或准确率统计通过。模型需另行配置，应用不会自动下载。[语音设置与限制](docs/VOICE_LOCAL_SETUP.md)、[真实验收记录](docs/COMPANION_ACCEPTANCE.md)。

用户已决定先完成实现，再集中进行剩余真实流程测试；这些验收已延期，并非通过。群聊只是后续可能的测试环境，**群聊接入尚未实现**，目前仍限制在配置的主人私聊内。[集中测试清单](docs/COMPANION_TEST_STAGE.md)。

| 从这里开始 | 使用入口与说明 |
| --- | --- |
| 切换日间／夜间 | **设置 → 外观**：日间、夜间或跟随系统。保留原字体和头像，各页与弹窗统一配色并有不同轻量点缀。本机开发版已提供。[外观与验收](docs/APPEARANCE.md)。 |
| 直接在 App 聊天 | **对话 → App 对话**，沿用已保存的 AI 配置，无需启动 QQ，聊天记录与草稿独立保存。[桌面对话](docs/DESKTOP_CHAT.md)。 |
| 在同一窗口使用 QQ | **QQ账号 → 本机组件 → 手动QQ客户端**，选择固定官方SSQQ安装包后打开。真实文字发送、主人收到及视图重开保留语言已通过；外部头像与媒体仍受限。[手动客户端](docs/QQ_MANUAL_CLIENT.md)。 |
| 让搭档看 QQ 图片 | 在主人私聊发送一张 JPG／PNG，或明确引用一张图片提问。Claude API、DeepSeek Flash 的部分真实看图／引用流程已通过，仍有支持边界。[图片输入](docs/QQ_INBOUND_IMAGES.md)。 |
| 不填账号先体验 | **工作 › 工作与结果 → 试用本地样例**，检查真实样例文本。打开结果可查看原文、字节数、SHA-256 或格式化 JSON；不需要 API key、项目目录或 AI 请求。这是本地文件检查，不是模拟 AI 聊天。 |
| 连接一位角色 | 先准备 AI，打开“QQ 账号”，启动并登录已有组件中的账号，再绑定搭档。在线卡片对已核实绑定提供“连接 AI”，对唯一符合条件的配置候选提供“核对并连接 AI”。两者均沿用已存配置和密钥，密钥框留空不会清除原密钥；绑定不明确时仍需选择搭档。手动桥接配置保留在高级设置中。[陪伴设置](docs/COMPANION.md#setup)、[QQ 整合](docs/QQ_INTEGRATION.md)。 |
| 调整相处方式 | **相处**：记得的事、约定回访、她的日记和角色卡。[功能入口](docs/COMPANION.md#nine-source-features-and-their-entrances)。 |
| 查看与主人的 QQ 消息 | **QQ 账号 → 当前搭档“更多”→ QQ 消息记录**。明确读取最近／更早一页，按需预览图片，可选舒展／紧凑间距。关闭即清空，不加入 AI 记忆。真实三页切换与一次图片预览已通过有界验收，广泛可靠性仍未验证。[消息记录说明](docs/QQ_OWNER_HISTORY.md)。 |
| 试用桌面语音 | 启动 App 对话后进入 **聊天 → App 对话 → 语音聊天**，无需 QQ；原已连接渠道的语音入口仍保留。[本机语音配置](docs/VOICE_LOCAL_SETUP.md)、[录音与确认](docs/VOICE_AND_CHARACTER_CARDS.md)。 |
| 分享一张图片 | 已连接的 QQ 搭档 → **分享图片**，核对预览和主人账号后发送。[图片支持与验收范围](docs/QQ_MEDIA.md)。 |
| 发送 QQ 语音 | 已连接的 QQ 搭档 → **分享语音**：选择支持的 WAV，或在另行配置本机 TTS 后输入短句生成；试听后明确发送给主人。此入口不会开始桌面录音。[语音片段与限制](docs/QQ_VOICE.md)。 |
| 处理好友申请 | 选中搭档并保存准确的 QQ／主人绑定，在已登录的 QQ 下打开 **QQ 账号 → 好友与群组 → 好友申请**。尚未连接 AI 时，临时会话只监听已保存主人的新申请；已连接时使用当前连接的收件箱。接受／拒绝需明确点击，不会连接 AI 或新增聊天权限。本地候选版已实现，真实 QQ 处理仍待验收。[说明](docs/QQ_FRIEND_REQUESTS.md)。 |
| 查看群成员 | **QQ 账号 → 好友与群组 → 群组 → 查看成员**，在原窗口查看、搜索并返回群列表。一个实际 23 人群和自身搜索已通过；大列表与群写入仍待验收。[说明](docs/QQ_GROUP_MEMBERS.md)。 |
| 管理已装插件 | **QQ 账号 → 本机组件 → 管理插件**，读取固定支持的插件清单，预览启停及共用配置影响。Cleaner 1.2.0 的安装、默认配置保存／重启读回及明确禁用已通过一次有界实测；真实清理及其他插件仍未验收。[说明](docs/QQ_PLUGINS.md)。 |
| 听懂 QQ 语音 | 断开搭档后 → **工作 › 渠道 → 相处方式 → 听懂我发来的 QQ 语音**，保存后重连。可选本机识别、文字回复，语音不触发命令；冷启动延迟与真实 QQ 格式兼容仍有限制。[说明](docs/QQ_INBOUND_VOICE.md)。 |
| 管理 QQ 后台 | **QQ 账号**：启停、诊断、配置备份与组件版本；应用崩溃后可检查并清理已核验的残留进程。[恢复流程](docs/QQ_RECOVERY.md)、[组件切换与回退](docs/QQ_COMPONENT_SELECTION.md)。 |
| 修改 QQ 资料 | 选中搭档 → **QQ 账号 → 更多 → QQ 资料**。读取并预览昵称／签名修改，或选择并预览正方形头像图片，再明确确认。AI 可以保持断开。一位账号的昵称／头像修改与明确恢复已在普通 QQ 中看到，不保证所有情况的同步。[资料说明](docs/QQ_SELF_PROFILE.md)、[头像说明](docs/QQ_AVATAR.md)。 |
| 派活或观察工作 | 使用下方独立派活模式，或在**设置 → Claude Code 观察器**安装观察器 hooks。[派活入口](#给-bot-派活)、[状态含义](#状态必须说实话)。 |
| 维护远端安装 | 源码入口：**QQ 账号 → 远程实例 → 远端 QQ 进程**。同一窗口内可检查并清理上次运行、管理原生 WebUI 通行密钥；两项均须服务端单独开启。真实远端流程仍待验收。[清理说明](docs/QQ_REMOTE_ORPHAN_CLEANUP.md)、[通行密钥](docs/QQ_PASSKEY_MANAGEMENT.md)。 |

**角色与接入：**原创动漫头像默认对应橘／Claude、龙娘／GPT 或 Codex、鲸鱼娘／DeepSeek；小芽与像素场景仍可选择。源码支持微信 **ClawBot**、本机 OneBot 桥接的普通 QQ 账号、本机 Claude Code、本机 Codex、Claude API、GPT API 和 DeepSeek API。新增源码入口为 [Gemini API](docs/GEMINI.md)、[豆包／火山方舟 API](docs/DOUBAO.md) 和指定主人私聊的[飞书企业机器人](docs/FEISHU.md)，三者仍待真实凭据／账号验收，飞书不等同于普通个人号。本机 Codex 仍用于派活，尚不是已核实完全无工具的陪伴入口。[X 标准私信](docs/X.md)已增加指定主人范围的实验源码入口，使用独立用户令牌，API 读写可能收费，并支持持久化 `/unsubscribe`；平台条件与真实账号仍未验收。新增 [Messenger Page](docs/MESSENGER.md) 实验源码入口，需独立部署 HTTPS 中继、Page 凭据与指定主人；不等同于 Facebook 个人号登录，真实授权、部署和收发仍待验收。每位搭档只面向配置的私聊主人。[人设说明](docs/PERSONAS.md)、[渠道与后端边界](docs/CHANNELS_AND_AI.md)。

**派活证据单独计算：**本机 Claude 程序模式已通过范围明确的真实 QQ、微信 ClawBot 聊天和批准写文件流程，无需 Channels 启动确认。本机 Codex 的聊天、文件与中断验证来自直接调用，不代表 QQ／微信派活闭环已通过。DeepSeek 的批准写文件验证使用真实 API，但消息渠道为本地模拟。上面的 GPT／DeepSeek QQ 陪伴回复不会改变这些派活边界。[Claude 程序模式](docs/CLAUDE_PROGRAM.md)、[Codex](docs/CODEX.md)、[GPT](docs/GPT.md)、[DeepSeek](docs/DEEPSEEK.md)。

**已发布预览版：0.3.0-preview.2，优先支持 Windows。**该版本的本机 Claude 模式采用官方 Channels 研究预览，需要在原版 CLI 中明确确认。上文较新的源码与本地构建能力，**不代表已发布的 preview.2 安装包包含这些功能**。历史 Channels 与后续程序模式的验证范围分别保留在[验证说明](docs/VALIDATION.md)中。

### 给 Bot 派活

**源码中的工作工具：**“工作与结果”提供官方会话状态核对、实验性的自有后台会话管理，以及基于 MCP Apps / Tasks 的本地产物查看器。微信可接收附带转写的语音及引用上下文；SQLite 记录消息去重和中断状态。后台与微信 Channels 的组合、手机语音／引用字段仍待真实验收，且不在已发布的 preview.2 安装包中。[实现与限制](docs/TECHNOLOGY_IMPLEMENTATION.md)。

电脑运行 `npm start`，先在**工作 › 渠道**页面准备 AI。微信使用手机 **我 → 设置 → 插件 → ClawBot** 扫描并确认应用生成的配对二维码；QQ 打开 **QQ 账号**，管理已有的本机组件、登录目标普通 QQ，再绑定搭档。独立的[完整运行组件准备入口](docs/QQ_NODE_SETUP.md)保留首次实际启动失败记录，修正后的隔离启动、显示二维码、停止和返回原安装已通过；Node 登录／聊天及干净 Windows 首次运行仍待验收。已有安装的使用条件见[单窗口接入](docs/QQ_INTEGRATION.md)，[高级桥接配置](docs/QQ.md)仍保留。接收工作前，选择一次性测试项目与派活模式：

| 入口 | 配置与权限 | 停止方式 |
| --- | --- | --- |
| **本机 Claude · 程序模式** | 安装并在原版 Claude Code 自行登录（实测 2.1.317），选择该模式后接收消息。不需要额外 API key 或 Channels 启动确认；每次工具操作仍需一次性批准。[详情](docs/CLAUDE_PROGRAM.md)。 | `停止` / `/cancel` 中断本轮并检查自有进程退出；`/new` 开启新对话。独立后台作业未核验。 |
| **API Agent** | 保存 Anthropic API key 后接收任务。SDK 对每次工具操作请求一次性确认，使用 API 计费。 | `/cancel` 中止应用管理的执行并清空队列。 |
| **Claude Channels · 手动启动**（兼容入口） | 安装 Node.js 22.13+ 和原版 Claude Code 2.1.317+，在 CLI 自行登录。连接所选渠道后点击**打开 Claude**，亲自确认自定义开发通道。Agent Arcade 不要求额外 API key。 | 当前源码支持发送 `停止` 或 `/cancel`，强制停止本应用持有并核验身份的 CLI 进程树；`恢复会话` 或 `/resume` 打开记录的同一会话。手动启动、未持有的进程仍仅暂停转发。 |
| **本机 Codex** | 安装并登录原版 Codex CLI，通过结构化 App Server 复用登录；项目操作遵循 Codex 原生权限规则。[设置](docs/CODEX.md)。 | `停止` / `/cancel` 中断确切的当前回合并等待结束事件；`/new` 开启新会话。 |
| **GPT API** | 单独保存 OpenAI API key，选择 GPT-6.1 Sol 或 GPT-6 Astra。支持经批准的项目文件操作，不执行终端命令；API 计费，不设美元费用上限。[设置](docs/GPT.md)。 | `停止` / `/cancel` 取消本地处理和待批准操作；不会回滚文件，也不保证远端请求已停止计费。 |
| **DeepSeek API** | 单独保存 DeepSeek API key；支持经批准的 Read/Write/Edit/List，不执行终端命令。API 计费，不设美元费用上限。[设置](docs/DEEPSEEK.md)。 | `停止` / `/cancel` 中止请求和待批准操作；已发生的文件改动不会回滚。 |

先断开再切换渠道或后端，各提供商的 API key 分开保留。Claude 程序模式对每次工具操作请求批准；Codex 与 Channels 遵循各自原生权限规则，部分已允许操作可能无需再次在聊天中确认。Channels 也可能将多条消息合并处理。运行时电脑和应用需保持开启；只有 Channels 兼容入口需要持续打开原版交互终端。消息会经过腾讯与所选 AI 提供商，QQ 桥接也会处理消息。**收到回复或平台受理回传，都不代表任务已验收成功。** 权限、停止方式与限制以各渠道和后端文档为准。

Channels 兼容模式收到并转发普通消息后保持安静，直接回传 Agent 的回复正文；权限请求和需要处理的异常仍会提示。启动命令仅在本次会话允许 `mcp__agent-arcade-wechat__reply`，仍受 CLI 的 deny/ask 规则与 hooks 约束，不跳过其他权限，也不写入永久允许设置。MCP 与转发计数放在桌面的“连接详情”中。

当前源码支持用短码回复 `同意 确认码` / `拒绝 确认码`，发送 `状态` 可重发尚未到期的原请求，不延长有效期。强制停止不是任务回滚，也不能确认独立后台作业已停止。Channels 恢复会话与最多 30 秒的本地通道瞬断重试都不重放离线消息；程序模式不会在应用重启后自动恢复模型会话。**本次实测限于 Windows 与当前账号的本机受控流程，真实断网/休眠恢复仍未验证；这些改动尚未包含在已发布的 preview.2 安装包中。** [当前证据与限制](docs/VALIDATION.md#wechat-control-and-recovery--localsource-2026-11-04)。

### 外部工具版本与观察器安装

从源码安装时，Claude API 的派活模式使用 Claude Agent SDK 0.3.317 / 其原生运行时 2.1.317（专有许可的可选依赖，随 `npm ci` 安装，不随打包产物分发）；两种本机 Claude 入口使用你单独安装的 Claude Code，当前程序模式实测 2.1.317。Codex 使用单独安装的原版 CLI；GPT 和 DeepSeek 分别使用自己的 API key。独立观察器支持 Claude 终端版本 2.1.277+（真实验收为 2.1.317）；hooks 直接调用进程，无需 shell 解析。本机 Codex 仍只用于派活。

不需要账号的本地检查：在**工作 › 工作与结果**点**试用本地样例**，应用会实际读取一份样例文本并在内置查看器里显示内容、字节数与 SHA-256；之后也可以点**选择文本文件**检查自己的文件。这是本地文件检查，不调用 AI。

使用独立的 Claude Code 观察器时，进入 **设置 → 安装钩子**，重启 Claude Code 后提交新任务。可以同时打开多个会话；子任务也会独立出现。点击“返回真实会话”退出示例观察器场景。

安装会合并 `~/.claude/settings.json`，备份原配置，并将观察脚本复制到 `~/.agent-arcade/bin/`。卸载只移除本项目的 hooks，保留其他配置。点击角色不会批准或执行命令，操作确认仍在 Claude Code 内完成。

## 工作区：Claude Code 观察器

- 多会话、子任务独立角色，状态文字、最近事件与时间可查。
- 原创 Sprout Bot 像素角色、苔藓工坊与月球邮局两套主题。
- 桌面通知默认关闭，启用后保持静音；前台抑制、通知冷却、免打扰。
- 迷你模式、窗口置顶、支持时关闭到托盘。
- 可选择保存最终回复，点击包裹查看；中英文界面与减少动画支持。
- 无脚本的 JSON 主题格式，社区可替换配色与七种状态的像素图。

## 状态必须说实话

| 场景 | 依据与边界 |
| --- | --- |
| 施工中 | 收到提交、工具调用或子任务开始事件；不表示完成百分比 |
| 等你确认 | 收到权限请求、询问或相关通知，请回 Claude Code 处理 |
| 发生错误 | 区分工具调用失败与回合 API 失败，后续活动可恢复 |
| 回复结束 | 收到回复边界，不代表代码通过测试或任务已验收 |
| 待确认 | 活跃状态超过五分钟没有新事件，或中断/父会话关闭后结果未知 |

后台任务未结束时不显示全部完成；定时唤醒单独显示待命。多个工具并发时，其他工具的完成不会清除仍在等待的批准。`Stop` 钩子发生时，其他钩子仍可能让回合继续，因此本项目保留事件记录并及时修正状态。

批准动作本身没有后续 hook，权限请求会保留到下一条工具或结果事件；无法唯一关联时显示待确认。比单独通知更快定位、打扰更少，仍是待做用户对照的假设。

![真实 Claude Code 双会话：一个运行，另一个请求确认](docs/evidence/live-waiting-running.png)

上图来自 Claude Code 2.1.317 的真实事件与无副作用测试命令，未使用演示模式。[查看恢复与回复边界证据](docs/VALIDATION.md)。

## 隐私与开源

独立的**观察器模式**无需账号或云服务，不添加遥测或网络监听。默认只记录项目文件夹名、会话与任务 ID、事件、工具名称/ID、时间，丢弃提示词、工具参数、完整路径和原始报错。最终回复需单独开启保存，最多 16,000 字符；观察器数据是本地普通 JSON，不加密。**聊天接入的数据流不同**：消息/模型输入经过腾讯与所选 AI 提供商，QQ 桥接也会处理 QQ 消息；已保存的聊天令牌与提供商密钥使用系统加密。旧 Claude Channels 使用临时认证的本地回环服务与私有 MCP 启动配置；[Claude 程序模式](docs/CLAUDE_PROGRAM.md)通过结构化进程协议控制原版 CLI。两种本机路径均不读取登录凭据。陪伴历史、可编辑事实和回访另存于本地 SQLite，不属于观察器回复采集；SDK 与原版 CLI 也可能另存会话内容。详见[陪伴存储](docs/COMPANION.md)、[微信](docs/WECHAT.md#privacy-restart-and-failure)、[QQ](docs/QQ.md)、[Codex](docs/CODEX.md)、[GPT](docs/GPT.md)和 [DeepSeek](docs/DEEPSEEK.md)。

观察器最多保留 200 个角色，每个角色保留 30 条事件；离线队列约 2,000 条，钩子运行时清理超过 24 小时的记录。关闭观察器回复保存会清除对应文本；“清理已结束会话”移除已结束的观察器会话，二者均不清除陪伴记忆。删除整个默认目录 `~/.agent-arcade/` 也会删除其中保存的搭档配置、凭据与记忆，不只是观察器数据；日常清理请使用应用中对应的控制项。Claude 配置旁的 hooks 备份另行保留。

完整测试使用 **Node 24.18+（24.x）**。先安装可选传输服务独立锁定的依赖；
此步骤不会启动监听端口或部署远端服务，也不改 Electron 的依赖。

```sh
npm ci --prefix deploy/transfer-helper --ignore-scripts --omit=optional --no-audit --no-fund
npm test
npm run check
npm run test:transfer-helper
npm run test:ui
npm run test:bot-ui
npm run test:bot-flow
npm run test:native
npm run dist
```

直接依赖已固定版本，实际解析的 `package-lock.json` 已入库，可通过 `npm ci` 复现依赖。macOS/Linux 提供构建配置，尚不属于 Windows 验收范围。

Agent Arcade 以 **GNU AGPL-3.0** 完全开源（[LICENSE](LICENSE)），不设收费功能。2026-11-13 之前发布的版本为 MIT 许可，仍然有效（[历史文本](LICENSE-MIT-HISTORICAL)）。取自 SillyTavern 的代码记录在 [src/vendor/sillytavern](src/vendor/sillytavern/README.md)。依赖保留各自许可，可选的 Claude Agent SDK 不属于 AGPL 分发内容，适用 Anthropic 的独立条款，见[第三方说明](THIRD_PARTY_NOTICES.md)。欢迎贡献真实微信验收、状态误报复现和主题。更多集成、IDE 跳转、签名安装包与自动更新留待后续验证。本项目与腾讯、Anthropic、PeonPing 无隶属关系。

## Agent 开发规范

后续开发请结合 [AGENTS.md](AGENTS.md)、[项目质量 brief](docs/QUALITY_BRIEF.md) 与 [贡献规范](CONTRIBUTING.md)：核实技术选择与参考作品，验证差异化价值，在现有架构和原创美术基础上完成实现与验收。

本次工作台改版的获奖作品、官网与 HCI 论文参考见[设计记录](docs/UI_REFERENCES.md)；新技术的收益、兼容性及采用边界见[技术调研](docs/TECH_RADAR.md)。调研候选不表示已经实现。

维护者准备材料：[带标签演示、集中真人验收与首批试用回访（未发布草稿）](docs/ADOPTION_TRIAL_KIT.md)。材料准备不代表试用或发布已经开始。
