# Bothouse contacts in Friends

## 星球居民在好友服务重启后恢复

保留原好友服务地址和 SQLite 数据库。房主已在新版服务连接居民、仅关闭 App 窗口且原登录仍有效时，服务启动后会恢复这次发布。它重核同一账号的登录与角色权限、配对版本及世界上的原星球和发布槽。Bothouse 或世界暂未就绪时，恢复会等待。访客仍须拥有当前的好友来访权限。关闭来访后，房主自己的居民可继续更新，访客无法查看。

服务端在受保护的好友 SQLite 库保存此星球的发布授权；对外接口不返回该授权。保护备份权限，灾备使用现有的 `--prepare-restore` 流程，旧登录及其发布授权随之失效。退出登录、断开 AI 或撤回角色权限后，相关授权不能用于恢复。旧版已连接但没有保存发布授权的星球，需要在新版从自己的星球重新连接一次；服务不会从旧主页记录推断用户同意。

## Standalone connection to stock Bothouse

The service operator supplies an absolute path in `SOCIAL_BOTHOUSE_CONNECTION` to a private **App-owned** TOML descriptor. Keep the descriptor and its parent directory readable only by the service account. Copy the upstream **public** identity file to `identity/signing.pub` beside it (or set `data_dir` to an absolute directory holding that public file). Never copy a private signing key, model credential or the original Bothouse configuration. Bothouse owns model setup and tool permissions. Friends needs Python 3.11+ with `websockets==15.0.1`; select the interpreter with `SOCIAL_BOTHOUSE_PYTHON`.

```toml
[management]
enabled = true
port = 9820
token = "<authorized management transport token>"
[bridge]
enabled = true
port = 9810
token = "<authorized Bridge transport token>"
[friends]
text_projects = ["harbor", "garden"]
```

Enable the two authenticated endpoints on the selected instance. The adapter connects to loopback. Stock Bridge may listen on all interfaces; isolate that listener according to the operator’s deployment policy. The text project list specifies the **exact Bridge project IDs** the operator has approved for chat and text assignments. Select projects with an appropriately isolated backend and tool policy. Friends cannot impose a no-tools mode on an upstream agent. A project listing, shared nickname, personal DSH inbox or membership in a Friends group does not grant access. Projects visible only in the native DSH roster have no verified Bridge target and cannot receive a turn here. The App uses the public instance fingerprint and stable Bridge project ID for both contacts and planet residents.

## Share and withdraw

After the intended person registers, the trusted operator confirms their exact Friends number. From the Agent Arcade module directory with the same database and descriptor:
```sh
node social/server/bothouse/pair.cjs projects
node social/server/bothouse/pair.cjs share reader_a harbor
node social/server/bothouse/pair.cjs unshare reader_a harbor
```
These local commands grant or withdraw just one project for one existing account. They apply to projects without a separate upstream user policy. The account may also redeem an operator-issued five-minute single-use code (`issue ACCOUNT --projects PROJECT...`). For projects with an upstream policy use its exact `arcade:ACCOUNT` assignment or pair the verified person using `issue ACCOUNT --identity UPSTREAM_ID`. Removing an upstream grant requires changing that policy in Bothouse. A host-side local grant cannot override it. A changed instance key invalidates the local binding. Normal restart preserves local grants; disaster preparation clears them. Ordinary chat participants supply no model key. After a grant, open Contacts → AI contacts; in a group the owner adds the contact and the sender selects its exact mention.

## Execution and limits

Friends uses authenticated `GET /api/v1/roles`, project `/users`, and the Bridge WebSocket capability snapshot and message/reply protocol. A private turn targets the stored peer. A group turn requires a current group seat, the sender’s own role access, and a selected mention. The service checks the upstream reply context, session and current authorization before delivering to the original conversation.

Tasks are recorded in the Friends database, one work order per original message. The durable claim precedes dispatch. Validated deliverables appear as `任务 #… · 已交回` followed by the result. A known invalid answer can be retried explicitly. When a worker disappears after a possible dispatch, its original record becomes uncertain and is not re-submitted. Tasks needing action outside chat wait for an external executor. The adapter uses stock Bridge for text and neither imports an external Python board nor calls a project-specific text-task API. Prior external-board claims without a matching App claim are left uncertain. Replies never certify that an external side effect happened.

Planet publication additionally requires Little Worlds, a current owner connection and a matching Friends origin. Only authorized stable role numbers are projected using the stock role event snapshot. New native DSH-to-Bridge equivalence is not inferred from a nickname. Stock offers no Friends-specific management share screen, separate verified no-tool invocation, or idempotent job status endpoint.
