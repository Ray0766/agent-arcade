# Original QQ installation probe and bridge boundary

Checked on 2026-11-06. The user has chosen to investigate an independently
authored ordinary-account QQ core. The working chat adapter remains in place.
This work implements a **real installation and IPC probe**, not authentication
or a messaging protocol, and does not replace the existing accounts.

## Executable result

From a repository checkout with `npm ci` completed:

```powershell
node scripts/qq-install-probe.cjs '<selected QQ installation directory>' '9.9.36-53644'
node scripts/qq-core-probe-host.cjs '<selected QQ installation directory>' '9.9.36-53644'
node --test --test-timeout=15000 test/qq-core-probe.test.cjs
```

The first command prints metadata. The second accepts UTF-8 JSON lines on stdin
and returns JSON lines on stdout. Its installation path is selected once at
startup; requests cannot select files or provide account credentials. Example:

```json
{"protocol":"arcade-qq-install-probe-v1","id":"inspect1","method":"inspect-installation"}
{"protocol":"arcade-qq-install-probe-v1","id":"state1","method":"status"}
{"protocol":"arcade-qq-install-probe-v1","id":"done","method":"close"}
```

| Method | Implemented behavior |
| --- | --- |
| `capabilities` | Installation metadata/fingerprint implemented; authentication, private-message events, sending and QQ Space explicitly not implemented. |
| `inspect-installation` | Reads only fixed QQ executable, application manifest, native-module metadata and ASAR inventory; returns sizes, hashes and PE architecture/registration metadata. |
| `status` | Reports whether installation was inspected and whether fingerprints match this machine's observed baseline. Account state and protocol compatibility remain unverified. |
| `close` | Releases the helper's input and deadline; does not stop any QQ process. |

Unknown methods return `CAPABILITY_NOT_IMPLEMENTED`. The helper accepts no
extra request fields, re-used IDs, arbitrary reads, login secrets or messages.
It bounds frames to 1 KiB, responses to 128 KiB, requests to 16 and expensive
inspections to two. Idle sessions close after 30 seconds. Because filesystem
inspection is synchronous, a future parent integration must additionally own
and enforce a process deadline; the real probe used a 15-second parent deadline.
This is repository tooling using the existing `@electron/asar` development
dependency; no runtime dependency or production UI has been changed.

The actual installation was inspected through a separate Node helper in
**583.424 ms**, exit code 0, with five protocol records and no stderr. All seven
selected executable/archive fingerprints matched the observed baseline.
Nine targeted tests passed, including real helper processes, malformed frames,
unknown actions, changed versions/files and a fixture launcher that must never
execute. These fixture tests establish input/lifecycle behavior only.

Private local receipts:

- `outputs/qqnt-install-metadata-20261106.json`: first actual installation read.
- `outputs/qq-core-original-probe-20261106.json`: actual helper IPC and metadata.
- `outputs/qq-core-probe-tests-20261106.json`: targeted test result and source hashes.

No QQ client/addon was started or loaded, no running process was injected, no
account/profile/session file was read, and no authentication or message was
attempted. There are no mock incoming messages or fake connected states.

## What the installed client establishes

The selected Windows client reports package `qq-chat`, version
`9.9.36-53644`; the executable's Windows version is `9.9.36.53644`.
Its manifest points to `./application.asar/app_launcher/index.js`.

| File | Observed bytes | Static observation |
| --- | ---: | --- |
| `QQNT.dll` | 214,599,720 | x64 PE32+, 3,385 named exports |
| `wrapper.node` | 117,866,024 | x64 PE32+, 66 named exports |
| `major.node` | 111,753,256 | x64 PE32+, no named exports |
| `ipc.node` | 1,030,704 | x64 PE32+, 32 named exports |
| `initIpc_x64.node` | 692,776 | x64 PE32+, no named exports |
| `application.asar` | 30,889,616 | 1,475 entries; launcher exists |

The archive inventory contains no matching `.h`, `.hpp`, `.d.ts`, SDK/include/
documentation directory or README document. This is a bounded inventory
finding, **not proof that no external SDK exists**. No exact standard
`napi_register_module_vN`, `node_register_module_vN` or
`node_api_module_get_api_version_vN` export was found in the six selected PE
files. That does not prove JavaScript bindings are absent; internal registration
or a different client host may be required. Two launcher entries were inspected
only for size and literal module-name presence in memory; their contents were
not copied into this project or evaluated.

Node's documented `.node` mechanism loads and initializes native code. A file
extension or PE export does not establish a supported login/message API, host
ABI compatibility or a safe standalone initialization sequence. The probe
deliberately does not `require` any QQ file. [Node addon documentation](https://nodejs.org/api/addons.html)

## Current official entry point is a different identity

Tencent's `@tencent-connect/qqbot-nodejs` **1.0.5**, examined at commit
`429a0f1b798f3b0fcef3679e207dbc0469a1df2d` (2026-10-12), offers REST and
WebSocket/Webhook messaging for registered QQ bots. It requires Node 20 or
newer and a developer bot's AppID/AppSecret. It does not document signing in
one of the user's existing ordinary QQ accounts. [SDK usage](https://github.com/tencent-connect/qqbot-nodejs/blob/429a0f1b798f3b0fcef3679e207dbc0469a1df2d/USAGE.md),
[pinned package](https://github.com/tencent-connect/qqbot-nodejs/blob/429a0f1b798f3b0fcef3679e207dbc0469a1df2d/package.json)

Tencent's `openclaw-qqbot` **2.0.4**, examined at commit
`89988812442583bf47c34b89f9abf5fd4b85df0b` (2026-10-12), provides a QR binding
wizard and outbound WebSocket operation. Its QR flow binds a registered bot;
it does not import an ordinary client's login session. Bot OpenIDs must remain
separate from existing QQ-number identities and private memories. Older SDK
statements about WebSocket withdrawal must not be generalized over these newer
official instructions. [Pinned official plugin guide](https://github.com/tencent-connect/openclaw-qqbot/blob/89988812442583bf47c34b89f9abf5fd4b85df0b/README.md)

## Relation to the four previously reviewed routes

The [earlier options review](QQ_CORE_OPTIONS.md) distinguishes four routes:

| Route | What this prototype changes |
| --- | --- |
| Official QQ bot API | A documented optional bot provider remains feasible; it does not meet the existing ordinary-account identity requirement. No bot application was created or authenticated here. |
| Original QQNT local bridge | This is the selected investigation. The original metadata/IPC helper is implemented; an independently understood normal-authentication and message-event entry point remains unresolved. |
| Original independent protocol | Not implemented. A metadata helper does not implement a network protocol, server authentication, cryptography or session recovery. |
| Another community implementation | No replacement was selected, copied or executed during this work. It is not the user's requested independent implementation. |

This prototype was written without copying NapCat implementation. It is not
described as clean-room work: earlier project work has examined NapCat source.
Replacing a local bridge cannot guarantee that the server will never invalidate
a session. Existing characters, model providers, memories, permissions and the
single application window need not be rebuilt to add a future provider.

## Minimum next bridge contract and the remaining blocker

The implemented helper can already back a version/installation diagnostic. It
must not be presented as a working connection button. A future message provider
can extend the same owned-child, bounded-IPC pattern only after it has a verified
client entry point:

1. `open`: use a designated ordinary account's **normal** authentication flow;
   distinguish awaiting login, rejected login and an independently observed
   signed-in identity. Do not obtain sessions from NapCat or another profile.
2. `subscribe`: emit actual private-message events with stable account, sender,
   message ID and session generation. Keep the configured owner's private-chat
   boundary; no automatic group/friend expansion.
3. `sendText`: correlate a real client's request and delivery/acceptance result.
   An ambiguous result remains unknown and must not trigger automatic replay.
4. `close` / recovery: stop only an owned helper; account invalidation stops
   outbound work and requests normal reauthentication. It is not inferred from
   the existence of a client process.

The current blocker is specific: the examined installation and official bot
SDK do not supply a verified, documented ordinary-account **host bootstrap +
normal authentication + private-message listener/sender** contract. Static
module names cannot fill those gaps. Loading an unknown native module or
inventing method names would not validate them. No account-protocol success is
claimed, and the existing working transport remains in place while that entry
point is unresolved. Actual identity, inbound/send round trip, restart and
multi-account isolation still require separate real tests at the user's
[concentrated test stage](COMPANION_TEST_STAGE.md).
