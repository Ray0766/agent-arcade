# Agent Arcade Friends

## Windows friends / Windows 好友

A Windows test build is available from your Friends service operator and is not yet listed in the Microsoft Store. Register or sign in, then look up your friend’s user number in **通讯录** (Contacts) and send a friend request. If you want to add an AI contact, copy your user number under **我** (Me) and give it to the Bothouse host. Once the host shares a role with that registered account, go to **通讯录 → AI 联系人 → 打开私聊** (Contacts → AI contacts → Open direct chat). Use a pairing code only if the host sends you one. The host runs Friends and Bothouse, so friends only need the app.

当前提供 Windows 内测包，微软商店尚未上架。打开运营方提供的内测包，注册或登录后，从「通讯录」搜朋友的用户号并发送好友申请。想加 AI 时，从「我」复制自己的用户号给 Bothouse 房主。房主按你的注册账号分享后，从「通讯录 → AI 联系人」找到角色，点「打开私聊」。只有收到配对码时才需要兑换。好友端只需这个 App，Bothouse 由房主运行。[好友首次使用](social/README.md)

## Run the service locally / 合作者本机运行

From the **Agent Arcade repository root**, run `npm run friends` with Node.js 24.18 or later in the 24.x line, then open the loopback address printed in the terminal. From an extracted module-only source ZIP, use `npm --prefix social start`. The web service uses Node's built-in HTTP and SQLite. Set `SOCIAL_DB` to choose a database. Open separate browser profiles to register two test users, add each other by user number and start a private or group conversation.

For AI contacts the service needs access to its configured Bothouse instance, authenticated management and Bridge listeners, Python 3.11+ and `websockets==15.0.1`. Set `SOCIAL_BOTHOUSE_PYTHON` to the intended interpreter. The [directory guide](social/server/bothouse/README.md) describes account visibility, required configuration and transport. The browser receives messages from the Friends service. Bothouse owns the underlying model connection. [Windows host and package build](social/windows/README.md) · [Friend service operation and backup](social/deploy/README.md)

Run `npm run friends:test` from the repository root for service regressions (or `npm --prefix social test` from the module source ZIP). The Windows package uses the pinned Electron version in [package-lock.json](package-lock.json), Windows SDK and x64 Visual C++ build tools. Service-only installation has no npm runtime dependencies.

### Daily chat and Little Worlds

Use the conversation list to search or pin a chat. In a conversation, quote a message to keep a link to its original, or use the composer to send a file, picture, voice message or bundled sticker. Use the message’s **⋯** menu to add an emoji reaction. In **好友动态** (Friends feed), friends can comment on posts they can see. On Windows the composer also supports screen snipping.

桌面「更多 → 小星球」在同一窗口打开部署方配置的世界，返回时保留原聊天和草稿。房主可以在自己的星球连接已获准的 Bothouse 角色。世界服务及其匹配的居民发布器需由部署方另行提供；普通聊天可独立运行。[配置与依赖](social/deploy/README.md#小星球居民) · [Windows 入口](social/windows/README.md)

### Reproduce role pairing locally

The original pairing fixture remains available in the [pinned Bothouse source below]. Run `python integrations/agent-arcade/test/bothouse/pairing.py` from that separate checkout with Python 3.11+, websockets 15.0.1, Node 24.18+ (24.x) and its Go dependencies cached. The fixture starts the management server and Bridge in a temporary directory. Two accounts redeem different test grants and receive replies from their own roles. A third account remains unpaired. The test checks restart and revocation while a reply is pending. The model session uses deterministic test replies.

## Source and licenses

The independent repository imports this module from the [pinned Bothouse source below]. The source commit is `c9be4df59e47e11830fe1bd34feaff78224917bc` and its `integrations/agent-arcade` Git tree is `6df6d38a082a4ed0fd5bf222342de9838d979bf7`. Original authors and revision references are retained. Bothouse runs separately for optional AI. The [Little Worlds installer](little-worlds/README.md) applies the integration delta to a pinned public game baseline whose [source and asset terms](little-worlds/NOTICE.md) are separate. This module retains Agent Arcade's [AGPL-3.0-only license](LICENSE), [historical MIT license](LICENSE-MIT-HISTORICAL), [third-party notices](THIRD_PARTY_NOTICES.md) and component-specific licenses. Generated project artwork has its own [portrait provenance](src/ui/portraits/README.md) and [brand provenance](src/assets/brand/README.md). The production desktop build uses `social/windows/pack.cjs` from this module and includes its own source and notices.

[pinned Bothouse source below]: https://github.com/Ray0766/bothouse/tree/c9be4df59e47e11830fe1bd34feaff78224917bc/integrations/agent-arcade
