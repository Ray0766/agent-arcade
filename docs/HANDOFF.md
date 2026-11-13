# 接手说明（2026-11-14，从 Windows 迁到 macOS 继续）

本文件随仓库走。`WORK_LOG.md`、`outputs/`、`work/`、`dist/` 都在 `.gitignore` 里，只存在于原 Windows 机器上；在新机器上请新建自己的 `WORK_LOG.md`。

## 先读

1. [AGENTS.md](../AGENTS.md)：用户定案与工作规范。检查点里提到的包名、进程号、`work/…` 备份路径只对原 Windows 机器有效。
2. [docs/MACOS.md](MACOS.md)：macOS 上支持什么、隐藏什么、怎么从源码运行和打包，以及**从未在真实 Mac 上验证过的事项清单**。
3. [docs/DECISIONS.md](DECISIONS.md) 顶部的 2026-11-13 条目、[docs/SILLYTAVERN_PARITY.md](SILLYTAVERN_PARITY.md)、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 现在的产品

下载一个 App、填一个 AI 的 API key，就能在 App 里和角色聊天。AGPL-3.0，完全开源，不设收费功能。

- **陪伴**：对话（内置角色与角色库角色）、角色库（SillyTavern V1/V2/V3 卡，PNG/JSON）、世界书、群聊、对话设定（人设、作者注释、预设、采样、正则）、消息编辑／重新生成／分支／流式、相处记忆、笔记与反思（模型只提议，主人逐条批准）、提醒（日历／文件夹／RSS 数据源，角色可主动提及）。
- **工作**：Claude Code 会话观察、任务看板（每任务一个 git worktree，目录内文件修改预先授权）、事件、工作与结果、可选渠道（微信 ClawBot、飞书、X、Messenger、手动 OneBot QQ）。
- **界面**：三种可选布局（沉浸式默认、聊天应用式、极简工具式），主题色默认跟随角色，可自定义。
- 首次打开：没有可用 AI 时落在「陪伴 › 对话」，页面是一张「选 AI、粘贴密钥、开始聊天」的卡片。

## 验证到什么程度（重要）

以下**全部只有单元测试和隔离窗口里的合成数据截图**，没有经过真实模型、真实数据源或真人日常使用：

- 直连 Claude 的会话 runner、各家流式返回、24000 字符上下文、采样参数。
- 角色库对话的完整往返（重新生成、续写、分支、群聊发言轮换）。
- 数据源（真实日历／订阅）与角色主动提醒。
- 笔记提议、反思、群聊调度员（没有任何服务商被探测过是否返回 logprobs）。
- 任务看板的真实派发：`--permission-mode acceptEdits` 是否被 `--bg` 接受、实际放行范围、新 worktree 的信任提示、`--permission-mode default` 在 Claude Code 2.1.318 是否仍被接受（其帮助文本列的是 `manual`）。
- 首次使用路径里密钥被拒／额度不足等分类提示（只用 DeepSeek 的测试替身走过）。
- macOS 上的一切（见 `docs/MACOS.md`）。

在 Windows 上由用户真实打开过的：`single-window-open-st-20261113` 与 `single-window-redesign-bothouse-20261113` 两个包在真实档案上启动过，数据库迁移成功；更细的真人验收没有记录。

## 已知缺口与未决事项

- 笔记与已批准规则只对角色库角色和群聊生效，内置角色（橘／龙娘／鲸鱼娘等）还不读。
- 任务看板只列出今天结束的任务，更早结束的任务在界面上看不到也移除不了，其 worktree 会留在磁盘上。
- 「返工」原因只记录，不会送达会话。
- 笔记检索没有停用词与分数门槛，可能有噪声。
- 内置角色在空对话里没有第一句问候。
- 若干 `scripts/*-ui-smoke.cjs` 引用了已移动的控件（`#desktop-local-stop`、`#onboarding-local-sample`、`#desktop-conversation-local`、旧页名「连接搭档」），未更新。
- README 中两处表述未逐条核对：「应用没有自己的服务器」、沿用自旧版的「有真实使用记录」的功能列表。
- 全量测试在 Windows 高并发下，`test/qq-supervisor-component-repair*.test.cjs` 等少数 live 测试会超时；CI 已把它们放到串行步骤。
- 普通 QQ 依赖的 NapCat 上游仓库已于 2026-11-12 清空；QQ 为可选的既有能力，不再扩展。替代方案未调研。

## 在新机器上的第一步

1. `npm ci`，然后按 `docs/MACOS.md` 从源码启动；先走一遍其中的未验证清单，从风险最高的开始。
2. 用全新档案：原机器上保存的 API key 用 Windows 系统加密，无法迁移，需要重新填写。
3. 看 GitHub Actions 的 `macos-latest` 结果：这条流水线从未运行过，预计还有需要修或跳过的测试。
