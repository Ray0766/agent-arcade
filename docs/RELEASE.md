# Agent Arcade 0.4.0-preview.8 — App-first development candidate

**Unpublished release-note draft, checked 2026-11-19.** The available public
release is still [0.3.0-preview.2 for Windows](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2),
with its older WeChat task/observer workflow. Its archived instructions are in
[the version-specific notes](https://github.com/Ray0766/agent-arcade/blob/e7b58508ffc79a108dc95f20685288ae3ca078d6/docs/releases/0.3.0-preview.2.md).
That executable does not contain the App-first key card described here.
No 0.4.0-preview.8 release has been published, and **no public Mac candidate
package is available**. Local packages and CI artifacts are not release assets.

> Source update — 2026-11-19: the documented `main` checkpoint is `e7b58508ffc79a108dc95f20685288ae3ca078d6`. The locally installed preview.8 was built from `8dd258c401554b51d89a8e6923586e8095783515`; [package hashes and bounded real-flow evidence](REAL_MEMORY_FLOW_20261116.md) identify that earlier build. Updating source is not publishing an installer.

## Publication readiness

The integrated source removes the automatic `prerelease` job. Its CI
on `main`, pull requests and manual dispatch validates and builds artifacts
with read-only repository contents permissions; it has no publication workflow
or Release-upload interface. The pinned integrated checkpoint includes this
publication separation. Local checks do not establish a successful GitHub CI run; inspect the
[Actions results](https://github.com/Ray0766/agent-arcade/actions) for the exact pushed commit. `npm run check:release` and `test/release-safety.test.cjs` check the local
workflow boundary; a passing guard is not authorization to publish.

Future publication needs explicit owner authorization, a committed source
identity matched to the tested package hashes, and completion of the remaining
real-key/model, native-dialog and human acceptance gates. Replace this draft
with that candidate's actual platform, identity and evidence before publishing;
do not attach a same-version package from a different source tree.

## Get the documented source

The development branch is `main`; this draft's reproducible
baseline is [`e7b58508ffc79a108dc95f20685288ae3ca078d6`](https://github.com/Ray0766/agent-arcade/tree/e7b58508ffc79a108dc95f20685288ae3ca078d6).
The default `main` follows development source, separately from Release assets. In a **new directory**, with
Git and Node.js 24.18+ within 24.x installed (the pinned package minimum is
22.13; the complete test suite requires 24.18+):

```sh
git clone --branch main --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion
cd agent-arcade-companion
git checkout --detach e7b58508ffc79a108dc95f20685288ae3ca078d6
git rev-parse HEAD
npm ci
npm start
```

The printed commit must match the full hash above; `package.json` at that
commit says `0.4.0-preview.8`. Do not reset an existing working copy to follow
these instructions. This checkpoint includes the original 75-path integration,
the preparation changes, fixed credential client, chat recovery, native Quit
and forgotten-reply announcement repairs. The original dirty checkout remains
separate and untouched. [Candidate identities](CANDIDATE_STATUS.md) distinguish
source, local package and historical evidence.

## First use of the development candidate

Both README languages use the same [中文 / English first-run guide](FIRST_RUN.md).
The next acceptance path prioritizes Chinese desktop text companionship with
an existing API key; QQ expansion remains frozen and 3D stays deferred.

1. Start with a fresh profile and open **Companion → Chat / 陪伴 → 对话**.
2. Choose Claude, GPT, DeepSeek, Gemini or Doubao.
3. Paste that service's API key in the App and choose **Save and start chatting / 保存并开始聊天**. Keys are saved locally with OS encryption. API usage is billed by the provider, separately from consumer subscriptions.
4. Type a message and send it. Conversation mode supplies no execution tools; **Stop** cancels this foreground reply. Model output is not verified task success.

QQ, WeChat, a project directory, hooks and a local CLI are not prerequisites
for this API-chat path. Optional coding and channel connections remain on the
Work side. The application supplies neither model credits nor a cloud runtime;
keep the computer and App running. Default App chat calls the chosen provider
directly; optional relay/remote services require separate deployment.

Without a key, `npm run demo` shows labelled observer examples under
**Work → Sessions**; it does not simulate a successful AI conversation. The
bundled local file check is under **Work → Work & results → Try local sample**.
Both use the same default data folder as normal startup: demo is not an
isolated profile. Close an existing copy before starting another.

## Source capabilities and platform boundaries

The App-first source includes built-in/library characters, SillyTavern
PNG/JSON cards, world info, conversation settings, message editing and
library-character regeneration/branches/streaming, groups, explicit App memory,
owner-approved notes/reflection and opt-in calendar/folder/feed notices.
Three layouts share Companion and Work workspaces. These are source features,
not a claim that the public preview contains them or that every flow is accepted.

The pinned source includes built-in context/rework, task-board history/rework,
macOS child cleanup, update backups, credential isolation and later chat/memory
repairs. Their scope and remaining gates are in [the integration report](MACOS_INTEGRATION_20261115.md)
and [latest real-memory report](REAL_MEMORY_FLOW_20261116.md).

On macOS, source startup and local ad-hoc packaging have bounded real-machine
evidence. The package is unnotarized; Intel and second-Mac use remain unaccepted.
Voice, local QQ management, managed terminal startup and provider sign-in
windows are not supported there; manual existing OneBot settings are separate.
See the [macOS platform notes](https://github.com/Ray0766/agent-arcade/blob/e7b58508ffc79a108dc95f20685288ae3ca078d6/docs/MACOS.md).
Windows speech models and optional Python runtimes are not downloaded automatically.

QQ remains optional, user-supplied and frozen for expansion. NapCat's upstream
stopped publishing; component-download/setup code is not a working fresh-install
promise. WeChat is ClawBot, not ordinary personal WeChat or Moments. App library
groups are distinct from autonomous QQ groups. Local Codex is coding-only until
its tools can be verifiably disabled. Existing channel/backend permissions and
per-account memory boundaries remain in force.

## Evidence and unfinished acceptance

The [tracked validation page](VALIDATION.md)
separates public-release evidence, the pinned development baseline and later
dated local checks; historical uncommitted statements apply only to their recorded checkpoints. Raw work logs, private screenshots and local build
paths are not public evidence or downloads.

- The local preview.8 has bounded real DeepSeek chat, manual-memory recall, isolation and forgetting evidence; the fixed credential component and native Quit have versioned checks. These do not accept first-stranger installation, general memory/reminder quality, another Mac's Keychain authorization, notification/file-picker dialogs, real IME, human daily use or sleep/wake.
- Earlier bounded QQ/Claude task and observer evidence retains its own version and route. It does not accept the new App-first path. The [sanitized nine-feature receipt](https://github.com/Ray0766/agent-arcade/blob/e7b58508ffc79a108dc95f20685288ae3ca078d6/docs/evidence/companion-nine-20261105.json) explicitly leaves the milestone unfinished.
- Real Claude Code background dispatch/rework, trust prompts and `acceptEdits` scope require separate acceptance with a supported CLI (2.1.317+). Hand-back is not owner acceptance. Gemini/Doubao credentials and broader channel deployment remain unaccepted.
- Excluded-friend Qzone visibility, a known remaining bubble queue and hands-free spoken interruption remain unfinished; the voice exercise is deferred, not passed.

The development source is AGPL-3.0-only; earlier MIT releases retain their
license. The proprietary Claude Agent SDK is excluded from packages. The personal-use Mac package is self-signed and unnotarized. No public
signed/notarized installer, automatic updater, general account compatibility,
comparative quality or performance improvement is claimed. Do not publish
keys, chats, runtime profiles or private acceptance captures as release assets.
