# Agent Arcade 0.4.0-preview.1 — App-first development candidate

**Unpublished release-note draft, checked 2026-11-15.** The available public
release is still [0.3.0-preview.2 for Windows](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2),
with its older WeChat task/observer workflow. Its archived instructions are in
[the version-specific notes](https://github.com/Ray0766/agent-arcade/blob/3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4/docs/releases/0.3.0-preview.2.md).
That executable does not contain the App-first key card described here.
No 0.4.0-preview.1 release has been published, and **no public Mac candidate
package is available**. Local packages and CI artifacts are not release assets.

> Later local candidate: **0.4.0-preview.2**, unpublished. Integration/build evidence is in [MACOS_INTEGRATION_20261115](MACOS_INTEGRATION_20261115.md). The pinned 3edf1ce and earlier preparation descriptions below retain their own scope; they are not the new artifact identity.

## Publication readiness

This adoption-readiness branch removes the automatic `prerelease` job. Its CI
on `main`, pull requests and manual dispatch validates and builds artifacts
with read-only repository contents permissions; it has no publication workflow
or Release-upload interface. The pinned `3edf1ce` workflow below predates this
change. This branch has not been pushed, and the revised CI has not run on
GitHub. `npm run check:release` and `test/release-safety.test.cjs` check the local
workflow boundary; a passing guard is not authorization to publish.

Future publication needs explicit owner authorization, a committed source
identity matched to the tested package hashes, and completion of the remaining
real-key/model, native-dialog and human acceptance gates. Replace this draft
with that candidate's actual platform, identity and evidence before publishing;
do not attach a same-version package from a different source tree.

## Get the documented source

The development branch is `codex/companion-nine`; this draft's reproducible
baseline is [`3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`](https://github.com/Ray0766/agent-arcade/tree/3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4).
A plain clone selects the older default `main`. In a **new directory**, with
Git and Node.js 24.18+ within 24.x installed (the pinned package minimum is
22.13; the complete test suite requires 24.18+):

```sh
git clone --branch codex/companion-nine --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion
cd agent-arcade-companion
git checkout --detach 3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4
git rev-parse HEAD
npm ci
npm start
```

The printed commit must match the full hash above; `package.json` at that
commit says `0.4.0-preview.1`. Do not reset an existing working copy to follow
these instructions. Later local, uncommitted repairs are not in this checkout;
the version number alone cannot distinguish those working-tree builds.

The earlier readiness-only branch did not integrate the separately frozen
repairs. The current local integration does: its newly built `0.4.0-preview.2`
archives and full source hash are recorded in [the integration report](MACOS_INTEGRATION_20261115.md).
They are not available through the pinned public-source command above. See
[candidate identities](CANDIDATE_STATUS.md) before interpreting package or test records.

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

The pinned baseline still has known gaps: built-in knowledge/rework,
task-board history/rework delivery and macOS child cleanup were repaired only
in the later uncommitted working tree. Those repairs and its local ad-hoc signed
arm64 package are not obtainable from the pinned baseline or public release.

On macOS, source startup and local ad-hoc packaging have bounded real-machine
evidence. The package is unnotarized; Intel and second-Mac use remain unaccepted.
Voice, local QQ management, managed terminal startup and provider sign-in
windows are not supported there; manual existing OneBot settings are separate.
See the [macOS platform notes](https://github.com/Ray0766/agent-arcade/blob/3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4/docs/MACOS.md).
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
uncommitted local checks. Raw work logs, private screenshots and local build
paths are not public evidence or downloads.

- Real Mac windows, SQLite, fake-key OS encryption, provider stand-ins and component tests do not accept a real-key first conversation or real-model memory/reminder quality. Keychain/notification/file-picker dialogs, real IME, human daily use and sleep/wake remain unaccepted.
- Earlier bounded QQ/Claude task and observer evidence retains its own version and route. It does not accept the new App-first path. The [sanitized nine-feature receipt](https://github.com/Ray0766/agent-arcade/blob/3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4/docs/evidence/companion-nine-20261105.json) explicitly leaves the milestone unfinished.
- Real Claude Code background dispatch/rework, trust prompts and `acceptEdits` scope require separate acceptance with a supported CLI (2.1.317+). Hand-back is not owner acceptance. Gemini/Doubao credentials and broader channel deployment remain unaccepted.
- Excluded-friend Qzone visibility, a known remaining bubble queue and hands-free spoken interruption remain unfinished; the voice exercise is deferred, not passed.

The development source is AGPL-3.0-only; earlier MIT releases retain their
license. The proprietary Claude Agent SDK is excluded from packages. No
signed/notarized installer, automatic updater, general account compatibility,
comparative quality or performance improvement is claimed. Do not publish
keys, chats, runtime profiles or private acceptance captures as release assets.
