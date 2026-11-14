# 接手说明（2026-11-14，从 Windows 迁到 macOS 继续）

本文件随仓库走。`WORK_LOG.md`、`outputs/`、`work/`、`dist/` 都在 `.gitignore` 里，只存在于原 Windows 机器上；在新机器上请新建自己的 `WORK_LOG.md`。

新会话可直接复制 [完整接手提示词](NEXT_SESSION_PROMPT.md)。本次文档交接使用分支 **`codex/companion-nine`**；在 Mac 上请先同步这一分支并保留当地未提交改动，不要只拉默认分支。

## 本会话收尾与远端同步（2026-11-14）

用户要求停止本 Windows 会话的功能开发，改在新会话继续；收尾只做阅读、审计和文档整理，未修改产品源码、未运行产品测试、未操作应用窗口或账号。三个并行审计均已停止，无待整合代码或半成品。审计基线为 `6715dbf`（桌面 smoke 脚本已更新）；随后按用户的文档提交／推送要求，先快进同步远端至 `f43ef0d`，保留本地接手文档改动。该远端版本包含下面所述的 Mac 实机与 CI 修复，不能再把 macOS 整体标成“从未运行”。

新会话继续以 **App 内陪伴和 macOS 适配** 为范围，QQ 不扩展、独立 QQ 核心实验保持暂停。优先可修的三处代码缺口如下，均尚未实施：

- 内置角色：Wiki 开关与读取回调已有，但 `LocalConversation.customReply` 对非角色库角色回落旧提示词路径，未注入笔记和批准规则；`test/wiki-pipeline.test.cjs` 还断言内置角色不读取。接入须保持逐条批准、每角色开关默认关闭及上下文预算。
- 任务看板：`TaskBoard.summary` 仅返回 `finishedToday`；生产创建看板时未接 `deliver`，返工理由只记录。历史任务入口与实际返工均待实现，不能把建议中的“同 worktree 新一轮”写成已具备能力。
- macOS 本机 Claude：停止目前只处理主 CLI，子进程清理由 CLI 负责。独立 POSIX 进程组是待评估方案，尚无代码或真机验证。

本机仍为 Windows；远端记录了真实 Mac 上的隔离启动、服务商替身驱动的窗口流程和打包，以及 macOS CI 连续通过后成为阻断检查。真实密钥／模型、系统弹窗、人工输入及需要新版 Claude Code 的工作区流程仍未验收；逐项以 [MACOS.md](MACOS.md) 的清单为准。本次文档同步没有重新执行这些验证。旧 Windows 包名与进程号不能作为当前运行状态。3D 角色仅列入后续计划，不启动建模，也不阻塞当前功能补齐。

## 先读

1. [AGENTS.md](../AGENTS.md)：用户定案与工作规范。检查点里提到的包名、进程号、`work/…` 备份路径只对原 Windows 机器有效。
2. [docs/MACOS.md](MACOS.md)：macOS 上支持什么、隐藏什么、怎么从源码运行和打包，以及**实机已验证与仍未验证的逐项清单**。
3. [docs/ACTIVE_GOAL.md](ACTIVE_GOAL.md)：当前交接范围；其中旧 Windows 检查点保留历史语境。
4. [docs/DECISIONS.md](DECISIONS.md) 顶部的 2026-11-13 条目、[docs/SILLYTAVERN_PARITY.md](SILLYTAVERN_PARITY.md)、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 现在的产品

下载一个 App、填一个 AI 的 API key，就能在 App 里和角色聊天。AGPL-3.0，完全开源，不设收费功能。

- **陪伴**：对话（内置角色与角色库角色）、角色库（SillyTavern V1/V2/V3 卡，PNG/JSON）、世界书、群聊、对话设定（人设、作者注释、预设、采样、正则）、消息编辑／重新生成／分支／流式、相处记忆、笔记与反思（模型只提议，主人逐条批准）、提醒（日历／文件夹／RSS 数据源，角色可主动提及）。
- **工作**：Claude Code 会话观察、任务看板（每任务一个 git worktree，目录内文件修改预先授权）、事件、工作与结果、可选渠道（微信 ClawBot、飞书、X、Messenger、手动 OneBot QQ）。
- **界面**：三种可选布局（沉浸式默认、聊天应用式、极简工具式），主题色默认跟随角色，可自定义。
- 首次打开：没有可用 AI 时落在「陪伴 › 对话」，页面是一张「选 AI、粘贴密钥、开始聊天」的卡片。

## 验证到什么程度（重要）

以下 App 功能**尚无真实模型、真实数据源或真人日常使用的端到端验收**；已有单元测试、隔离窗口合成数据，以及下述 Mac 上服务商替身驱动的运行记录，不能相互替代：

- 直连 Claude 的会话 runner、各家流式返回、24000 字符上下文、采样参数。
- 角色库对话的完整往返（重新生成、续写、分支、群聊发言轮换）。
- 数据源（真实日历／订阅）与角色主动提醒。
- 笔记提议、反思、群聊调度员（没有任何服务商被探测过是否返回 logprobs）。
- 任务看板的真实派发：`--permission-mode acceptEdits` 是否被 `--bg` 接受、实际放行范围、新 worktree 的信任提示、`--permission-mode default` 在 Claude Code 2.1.318 是否仍被接受（其帮助文本列的是 `manual`）。
- 首次使用路径里密钥被拒／额度不足等分类提示（只用 DeepSeek 的测试替身走过）。
- macOS：2026-11-14 已在真实 Mac 上用假密钥和服务商替身由脚本驱动过一遍，修了三处；真实密钥、真人操作和需要 Claude Code 2.1.317+ 的部分仍未验收，逐项见 `docs/MACOS.md` 末尾清单。

在 Windows 上由用户真实打开过的：`single-window-open-st-20261113` 与 `single-window-redesign-bothouse-20261113` 两个包在真实档案上启动过，数据库迁移成功；更细的真人验收没有记录。

## 已知缺口与未决事项

- 笔记与已批准规则只对角色库角色和群聊生效，内置角色（橘／龙娘／鲸鱼娘等）还不读。
- 任务看板只列出今天结束的任务，更早结束的任务在界面上看不到也移除不了，其 worktree 会留在磁盘上。
- 「返工」原因只记录，不会送达会话。
- 笔记检索没有停用词与分数门槛，可能有噪声。
- 内置角色在空对话里没有第一句问候。
- 七个主要桌面 smoke 脚本已在 `6715dbf` 更新（smoke、bot、chat、providers、workbench、persona、native）；既有日志记录了隔离源码运行通过，本次未重跑。其他专项脚本仍须按实际使用检查，不能视为全部已更新；打包 exe 与标准 bootstrap 的回归仍待确认。
- README 中两处表述未逐条核对：「应用没有自己的服务器」、沿用自旧版的「有真实使用记录」的功能列表。
- 全量测试在 Windows 高并发下，`test/qq-supervisor-component-repair*.test.cjs` 等少数 live 测试会超时；CI 已把它们放到串行步骤。
- 普通 QQ 依赖的 NapCat 上游仓库已于 2026-11-12 清空；QQ 为可选的既有能力，不再扩展。替代方案未调研。

## 在新机器上的第一步

1. `npm ci`，然后按 `docs/MACOS.md` 从源码启动；先走一遍其中的未验证清单，从风险最高的开始。
2. 用全新档案：原机器上保存的 API key 用 Windows 系统加密，无法迁移，需要重新填写。
3. GitHub Actions 的 `macos-latest`：首次运行失败 13 项，已修；2026-11-14 在 GitHub 上连续三轮通过后去掉了该平台的 `continue-on-error`，现在和 Windows 一样卡合并。`ubuntu-latest` 仍不卡合并，剩 56 项失败集中在 QQ 待处理锁的 6 个测试文件，尚未排查。
