# Agent Arcade — 研究、设计与验收 brief

## 2026-11-06 当前产品范围

主体验是单窗口的 AI 角色聊天与账号管理。每位搭档独立配置一个渠道、后端与指定私聊主人；多个搭档可在同一应用同时连接。当前本机 Claude 程序模式不加载 Channels；旧 Channels 保留为兼容入口。QQ 账号页管理组件准备、环境选择、扫码登录、绑定及条件满足时的“连接 AI”，不会因显示运行或接口受理而宣称已登录、聊天成功或对方已收到媒体。独立 Node 环境的新建、选择、配置、隐藏启动、真实二维码显示、停止与返回原环境已有有界实测；Node 登录／聊天与干净环境安装仍待验收，群聊接入与普通个人微信尚未实现。实际入口、实现清单和有界验收见 [QQ 整合](QQ_INTEGRATION.md)、[渠道与 AI](CHANNELS_AND_AI.md)和[当前目标](ACTIVE_GOAL.md)。

最新视觉采用用户选定的雾粉色、原创头像与带聊天气泡和 bot 的丝带候选标志，logo 尚未最终定稿。QQ 页面使用角色卡片总览、同窗口居中扫码面板和轻量花枝／龙纹／鲸尾点缀；其余页面沿用相同配色与细线层级，字体、字号保持原有设定，登录面板与全应用统一。复杂进程和恢复信息在对应详情展开。装饰不能遮挡真实二维码静区，状态仍按独立的 QQ 登录和 AI 连接事实呈现。观察器场景与像素主题作为独立入口保留，不要求聊天用户先安装 hooks。当前参考及适用边界见 [UI_REFERENCES.md](UI_REFERENCES.md)。以下日期更早的描述保留其历史语境，不能覆盖本节或最新用户决定。

## 2026-11-05 当前验收重点

用户将主体验调整为“像好友一样使用独立社交账号的 AI 角色”，第一版先对主人自主聊天、经营 QQ 空间。沿用 Electron 与现有头像、模型接入和消息桥接。当前最小闭环应验证角色／联系人记忆跨重启保持、主动联系可选择不发送、暂停阻止未提交动作、身份切换不继承私密记忆或主动权限、模糊发送结果不自动重放。空间正文生成不得提供私聊与私人记忆；接口返回成功与实际可见范围分别核验。自然程度与情感交流价值需真实使用反馈，不能由单元测试推出。旧派活约束继续适用于派活模式；最新实施与证据见 [COMPANION.md](COMPANION.md)。

配合根目录 [AGENTS.md](../AGENTS.md) 使用。初次资料核对：2026-11-03。当前已有 Electron＋Claude Code hooks 预览实现；功能与验证状态以最新 README、[架构](ARCHITECTURE.md)、[验证记录](VALIDATION.md)及实际运行结果为准。下文是持续改进的质量目标，不表示各项已验收。

**历史里程碑（2026-11-03 至 preview.2）：**用户明确“在微信向 Bot 发信息，直接给 Agent 派任务”，并要求保留 API 与本机 Claude Code 两个入口。该版本的本机模式使用原版交互 CLI Channels，不要求额外 API key；API 模式使用独立 key 计费。2026-11-04 的 preview.1 最小真实闭环包含独立文件检查与主人确认手机回执，当时 API 真实流及本机取消/恢复仍待验收。后来的程序模式、渠道与验收见 [WECHAT.md](WECHAT.md)、[CLAUDE_PROGRAM.md](CLAUDE_PROGRAM.md)及[验证记录](VALIDATION.md)。持续适用的约束是：聊天需要网络，不能称整个产品不上云；转发、MCP 连接、裁决、真正停止与成功分别表述。

preview.2 在本机会话中仅精确允许微信 reply 工具，不跳过其他权限或写永久设置；普通消息成功转发保持静默，回复正文不加固定结果前缀，诊断放桌面详情。必要权限与异常仍提示。当时普通回复是否无需重复确认、是否降低打扰，需要独立复验，不能由 preview.1 的闭环推断；后来的结果按各自验证日期保留。

## 独立观察器的任务与核心亮点

用户希望专注其他工作，同时知道 Agent 是否需要介入。继续验证“可信状态的环境式反馈”：用少量原创角色动作表达真实事件，让用户快速找到需要处理的任务，而不是持续盯动画。

这一观察器入口覆盖 Windows、Claude Code 会话及子任务。闭环：接入事件 → 可靠状态 → 角色/文字提示 → 返回原工具处理或查看已采集的回复。它不是整个产品的渠道或模型范围限制。直接跳转 IDE 等能力仍需单独实现与验证，不能把规划写成现有功能。

## 技术探索应回答什么

1. 基于现有 Claude Code 官方 hooks 适配，复核目标版本的事件语义及覆盖范围。记录会话/任务身份、去重标识、时间、顺序依据和来源；优先显式事件，不持续读屏猜状态。
2. 保留“回复结束不等于工作成功”的契约。区分等待权限、工具可恢复失败、回合失败、后台任务、会话结束及不确定状态；说明重复、乱序、迟到和缺失事件如何影响可信度。
3. 当前采用 Electron，先按官方安全指南检查渲染隔离、IPC 和外部链接，再实测托盘、DPI、休眠恢复与资源占用。版本以清单及依赖记录为准；只有发现实质瓶颈，才对比其他桌面方案，不能自动迁移技术栈。
4. 保持短生命周期观察进程、有界本地 inbox 和状态归约的职责分离。主题只描述受控资源和动画映射，不执行任意脚本；日志文本与本地路径不得成为命令。
5. 隐私默认项、通知冷却、前台抑制和静音属于产品契约。增加字段前核对必要性、保留期限、清除方式和敏感信息泄露风险，不为了展示“智能”采集完整对话。

## 优秀参考与转化方向

下列来源已核对，借鉴是待验证建议。获奖类别按官方记录列出；尚未完成参考作品的交互实测或视觉走查，后续设计需查看真实演示。角色资产、声音与文案不能直接搬用。

| 参考 | 类型与用途 | 建议借鉴及边界 |
| --- | --- | --- |
| [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) | 当前架构的官方文档 | 核查隔离、权限和 IPC；配置存在不代表已通过安全或目标系统验收。 |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks) | 真实事件来源的官方契约 | 按目标版本核对触发语义与载荷；事件说明、适配代码和状态文案应一致。 |
| [PeonPing](https://github.com/PeonPing/peon-ping) | Agent 声音与视觉通知工具 | 对照事件覆盖、静音与打扰控制；“会播放声音”已有替代方案，不能算唯一创新。 |
| [Apple Design Awards 2025：CapWords](https://developer.apple.com/design/awards/2025/) | Delight and Fun 类应用获奖作品 | 借鉴短动作对真实操作的反馈；角色表现必须有任务含义，不能只是循环装饰。 |
| [Apple Design Awards 2026：Is This Seat Taken?](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/) | Delight and Fun 类游戏获奖作品 | 研究角色轮廓、场景信息与轻松节奏；借鉴可读性，不复制角色或把生产工具做成游戏任务。 |

## 观察器的内容与视觉要求

- 保留 Sprout Bot、Moss Workshop 与 Lunar Post 的原创视觉方向；先解决状态可读性、空间密度与交互反馈，再考虑增加角色和主题。主题变更遵循 [THEMES.md](THEMES.md)。
- 先更新状态表，再更新角色动作：每个状态同时有可分辨轮廓/动作与文字标签。“Ready / 已交付”只表示回复结束，不暗示产物通过独立验收。
- 延续微场景与紧凑模式，默认小、安静、可隐藏；需要介入时才提高提示强度。重大布局调整才比较候选方案，不为每次小修复重做设计。
- 多任务可辨识；同类事件聚合、去重，尊重勿扰。未知状态坦诚显示，不用持续忙碌动画掩盖事件缺失。
- 中英文、静音和减少动画下仍可识别状态。复杂日志放详情，主界面文字说明事实与下一步，如“等待你的确认”“最近状态可能已过期”。
- 托盘、键盘、焦点与辅助技术替代路径属于核心体验；安装/移除 hooks 保留用户其他配置，不留下意外自启动项。

## 观察器的验收与演示

沿用 [CONTRIBUTING.md](../CONTRIBUTING.md) 的检查约定。新增行为补事件序列测试；UI 变化运行对应 smoke test 并检查截图。发布前更新验证记录，分别注明自动测试、真实集成与人工检查。

| 检查 | 最小证据 |
| --- | --- |
| 状态正确 | 固定事件集覆盖正常、重复、乱序、延迟、缺失、多个权限请求及未知事件；不因重复事件反复通知，也不误报全部完成。 |
| 真实集成 | 在声明的 Claude Code 版本中完成运行 → 等待 → 恢复 → 回复结束/失败，记录真实事件映射；合成载荷与浏览器演示不替代这一项。 |
| 恢复 | 进程崩溃、应用重启、系统休眠及父会话结束后，不显示未经证实的“已完成”；无法确认则显示不确定。 |
| 系统体验 | Windows 多屏、不同缩放、托盘、通知和焦点切换实测；不抢输入，不挡常用操作。 |
| 资源与打扰 | 声明机器、任务数量与事件负载，测空闲/多任务 CPU、内存及通知数量；预先设预算，无事件时不得忙循环。 |
| 隐私与无障碍 | 检查采集关闭/开启/清除、敏感字段丢弃，以及中英文、静音、减少动画、键盘和焦点路径。 |

演示重点是一个任务等待确认、另一个仍在运行，用户快速定位并返回 Claude Code 恢复前者。成功指标是状态辨识、恢复速度和低打扰；动画播放时长不是产品价值。

## Historical scope update — 2026-11-04

At this milestone the owner expanded the direction to multiple chat channels and AI backends, and selected a light anime chat interface. Channel identity, execution backend and cosmetic persona remain independent. The initial implementation used one connection per app process and three separate QQ processes; only bridge identity/online checks had passed at that point. The later account manager and real companion flows supersede those limits and pending statuses, as summarized at the top of this document. A catalog entry or implemented adapter still does not establish an authenticated connection or live acceptance. See [current channel evidence](QQ.md) and [validation boundaries](VALIDATION.md).
