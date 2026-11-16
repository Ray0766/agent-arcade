# Desktop conversation

The Windows package observations in this opening paragraph are historical. Current App/macOS source delivery is tracked in [APP_MACOS_PROGRESS](APP_MACOS_PROGRESS.md); the recorded package and desktop entry are retained in [the active scope](ACTIVE_GOAL.md).
They use the original profile and include independent App conversation, earlier
messages, App memory, send-key preferences and current-turn image input.
App reply notifications are a limited preview: **Windows notification display
remains unconfirmed**. Ju and Whale's original QQ/AI connections were restored
without a new scan or key; four encrypted vault hashes and the desktop entry
were verified. See [the active scope](ACTIVE_GOAL.md) for current operation.
This is a bounded local preview, not a published release. The earlier image
trials below remain their own acceptance evidence.

In **Chats**, select a companion and a conversation source, then type into the box below the conversation. **Send** or your selected send key starts one text turn. **Stop** cancels that foreground reply. The normal character and selected AI are reused.

The short note **Replies stay here / 仅在这里回复** is literal: typing in this desktop box does not send the prompt or answer to QQ, record audio, synthesize speech, or open coding tools. Both routes still call the selected AI service; this is not an offline model.

## Current source changes — 2026-11-14

Built-in App companions now use the same streaming preference and message
controls as library conversations: the last model reply offers **Regenerate**,
**Continue** and alternatives. A new built-in answer is stored as one complete
message (up to 2000 characters); existing history is retained. A memory-command
confirmation or source notice cannot be regenerated. Stop cancels the current
request, and partial streamed text is display-only: it is not saved as an answer.
The existing no-tools and per-character private-memory boundaries still apply.

An empty, ready built-in App conversation shows the character's name and three
starting suggestions. A suggestion fills the message draft; it never sends a
request or creates a fictional greeting in history.

**Companion → Notes / 陪伴 → 笔记** keeps separate **Can read** and **Can propose**
Wiki switches for each built-in or library character, both off by default.
A model only proposes edits; the owner approves each change before it enters
the notebook. On each App model request, an enabled character receives relevant
notebook lines as labelled, untrusted JSON, within the context budget. A page
used on a previous turn is searched again: the model requests are stateless and
cannot rely on a previous prompt retaining that page. Regeneration and
continuation perform the same bounded retrieval; turning reading off removes
notebook lines on the next request. Ordinary chat words and headings are
filtered, and weak lexical matches are dropped; this is not semantic retrieval
or a guarantee that every relevant note will be found.

Rules from reflection enter built-in App prompts only after individual owner
approval and while enabled. Unapproved candidates do not become guidance.
Built-in knowledge uses at most 1600 characters inside its existing
6000-character prompt cap and shrinks to preserve room for private context.
These paths have service/SQLite tests with injected model replies. Real-model
and human acceptance remain unfinished; historical evidence below applies to
its recorded version and scope.

## Switching App companions — 2026-11-15 source

The companion selector distinguishes **saved companion profiles** from
**built-in App roles**. A new installation may have only one saved profile;
it can still choose Ju, Dragon Girl, Whale Girl or the other built-in roles.

- **Immersive:** click the top-left portrait labelled **Switch companion / role**.
- **Messenger:** use **Built-in role · current AI** below the conversation list;
  on a narrow window, open the list first.
- **Minimal:** the same role selector sits above the conversation.

Choosing a built-in role changes only the App conversation's persona, name and
description. It **keeps the current AI provider and key**. For example, choosing
Whale Girl while Claude API is configured still calls Claude API; this choice
is not a claim that a DeepSeek account is connected. **Use profile role** returns
to the profile's existing persona and custom text. The selection is saved per
profile as `builtinPersonaId` in `local-companion/st-settings.json`; old profiles
without that field keep their original behaviour.

Each built-in role resumes its own App history and private memory in the
existing per-character scope. Choosing a different role does not copy or clear
those records, alter a connected social account, reset its activity switches,
or create another profile. Role changes wait until the current App reply ends
(or is explicitly stopped). **Add / manage companions** creates or manages
independent profiles when separate AI configuration is wanted.

Automated service/SQLite and production-renderer tests use synthetic model and
IPC responses; no owner profile, real key or real model was used for this check.

## Send key

Open **Settings → Chat / 设置 → 聊天** to choose **Enter to send / Enter 发送**
(the default) or **Ctrl+Enter to send / Ctrl+Enter 发送**. The selected shortcut
is also shown below the composer.

- With **Enter**, only plain Enter sends. Ctrl, Meta or Alt combinations do not send.
- With **Ctrl+Enter**, plain Enter inserts a line break; Ctrl+Enter sends. On macOS the setting is labelled **⌘+Enter** and Command+Enter also sends. Alt combinations do not send.
- **Shift+Enter** always inserts a line break, including when Ctrl is also held. Input-method composition/confirmation events and repeated keydown events do not submit a message. The Send button is unchanged.

This preference applies to the desktop composer in both App and connected-channel
conversations. It does not change the separate QQ message-history send button.
Saving keeps the draft, editor focus/selection and any pending reply; a failed
save leaves the previous preference selected. It does not change the companion
or conversation source.

**Connected QQ-source acceptance, 2026-11-08:** in the actual
`single-window-plugin-first-disabled-20261108` window, Whale/DeepSeek completed
one marker turn with Enter and another with Ctrl+Enter. With the latter selected,
plain Enter inserted a newline and did not submit. Both replies were labelled
Desktop. The original Enter preference and selected Ju companion were restored.
Four UI checks/four screenshots and independent read-only SQLite observations
retain this bounded flow. The two prompt/reply pairs occurred only in Whale's
QQ character scope; the other seven registered App/channel stores had no marker,
and all eight stores had zero new or updated action records during the observed
interval. Four encrypted credential hashes and the same main/two QQ launcher
identities were preserved. This is two real model turns with desktop-only
results, not a QQ delivery test, machine-wide traffic audit or native IME test.
Private evidence: `outputs/qq-desktop-keys-live-20261108/receipt.json` and
`outputs/qq-desktop-keys-live-isolation-20261108.json`.

## Conversation sources

- **App conversation / App 对话** is an explicit independent conversation. It reuses a saved AI key or the existing local Claude login and does not require QQ startup, configuration or login. Its history and explicit local memory live separately from the channel under the companion's `local-companion` directory. A stopped App conversation can be started again; starting does not send a model request or start a channel. API, local Claude program, DeepSeek, GPT API, Gemini and Doubao use their existing no-tools runners. Local Codex and legacy Claude Channels are not supported on this no-tools route. Provider configuration readiness does not prove current credentials or quota work.
- **QQ conversation / QQ 对话** retains the original connected companion route. Desktop-origin rows are labelled **Desktop / 桌面**, including older local voice-conversation rows. They share this character's QQ conversation context, so later QQ messages can draw on them. A disconnected channel or task-only mode does not become a companion engine merely by showing this source.

The saved connection page also offers **Chat in App / 在 App 里聊**. Missing keys lead to the existing same-window AI setup. Changing the foreground source does not rewrite the channel, owner, credentials or QQ memory. App and channel can remain available together with separate runners; stopping the App conversation does not disconnect QQ. Independent App voice is available from **App 对话 → 语音聊天 / App conversation → Voice chat** after starting the App conversation. It uses the existing speech installation without starting or logging in to QQ. Channel voice and QQ media sharing keep their separate route.

The independent route accepts the typed commands **记住：内容**, **查看记忆**, **更正 短码：内容** and **忘记 短码**. These commands affect only that character's local App memory. It cannot contact someone outside this App, publish a post, schedule a follow-up, autonomously access files or run tools. Enabled notice sources can supply a bounded reminder in the running App conversation; the deterministic controller owns its timing and limits. Explicitly selected pictures use the bounded route below. It does not copy QQ memory. Local SQLite history has the existing retention bounds and is not newly encrypted or cloud-synchronized.

## Send a picture in App chat

Select **Chats → App conversation → Add image / 对话 → App 对话 → 添加图片**,
then choose one static PNG or JPEG in the native file picker. A small preview
shows its normalized dimensions and size. Enter a question or caption—the text
field remains required—and use **Send** or the selected send key. This sends
the picture to the selected AI for this App reply, not to QQ. The connected-channel
desktop composer does not show this picture control.

Current image-capable routes are Claude API, GPT API with `gpt-6.1-sol` or
`gpt-6-astra`, and DeepSeek API with `deepseek-flash`. Other routes, including
local Claude/Codex, Gemini, Doubao and DeepSeek Pro, do not accept pictures here;
the local Add image control is disabled with an explanation. Text support is
separate from image capability. These capability checks are not a guarantee
that a provider's current credentials, quota or every image will work.

- The picker accepts one file up to 8 MiB. Static PNG/JPEG is decoded and
  normalized to PNG, at most 2048 pixels per edge and 4 MiB, with original
  metadata removed. Animated images and unsupported formats are refused.
- **Replace image / 更换图片** replaces the current selection; cancelling the
  picker retains it. **Remove / 移除** discards it. Choosing/removing blocks
  duplicate submissions while that operation is pending.
- A picture belongs only to its current companion, source and composer session.
  Switching companion/source or leaving Chats discards it. Unsent text retains
  its existing separate draft behavior; pictures are not cached with those drafts.
- Sending consumes the selected picture. An error or stopped reply does not
  automatically retry or restore it; select the picture again to resend it.
  Existing text-restoration rules still protect newer edits.
- App history retains a placeholder, the caption and any reply, not the image
  file or pixels. A later turn must attach the image again to inspect it. This
  describes this application's storage, not the provider's retention policy.
- Image text and a caption submitted with an image are conversation data, not
  commands or permission. They do not execute memory edits, tools, publication
  or account actions. Use a separate explicit text command or the App-memory
  editor for memory changes.

## Manage App memory

Local preview.8 has [bounded real DeepSeek evidence](REAL_MEMORY_FLOW_20261116.md)
for manual facts surviving App restart, two-persona isolation and forgetting
before/after restart. It also clears hidden completed-reply announcements when
their message or conversation is no longer current. The dated evidence is local
and unpublished; it does not certify arbitrary natural-language extraction or
large-memory recall.

Open **Together → Memory → App memory / 相处 → 记得的事 → App 记忆**.
Choose the companion, enter up to 500 characters and select **Remember this**.
Each saved row can be edited or explicitly forgotten. This editor works while
App chat is stopped and without an API key, a running AI or QQ login. It does
not switch the foreground conversation source or copy QQ memories.

Saving cancels an active App reply and waits for that account's owned App
speech to finish closing before changing memory. A failed cleanup prevents the
write. Correcting or forgetting also clears this character's recent App
conversation and freeform notes, and removes records containing the same old
fact. Unrelated structured facts, other characters and QQ records remain.
The editor checks the selected account, character, current memory view and row
revision; stale edits are refused rather than silently overwriting a newer
value. It does not make these locally stored records encrypted or synchronized.
Existing typed memory commands remain available in an active App conversation.

## Behavior

- **View earlier messages / 查看更早消息** expands the independent App conversation by 30 saved messages at a time, up to its existing 120-message retention limit. It reads this character's local record; it does not fetch QQ history, call a model, change the model's context budget or stop an active reply. The reading position is kept when older rows appear. Paused App conversations can still be read. The expanded view resets when the character changes or the application restarts; saved rows retain their existing lifetime. Correcting or forgetting memory can remove related conversation rows, including rows already expanded on screen. This is a view of retained messages, not a permanent complete archive.

- The new **QQ conversation / QQ 对话** source view also provides **View earlier
  messages**: its initial 60 local rows expand to 90, then at most the existing
  120-row limit. It uses that already bound QQ companion's saved record, including
  Desktop-labelled turns; it does not fetch OneBot history, call AI, enlarge the
  model's 30-row context or change storage retention. Paused retained bindings
  remain readable, but a cold start without the channel binding does not add an
  offline QQ-history entrance. Account/source/character changes retire the old
  view, and related memory edits can remove rows. The active scope distinguishes
  source verification from current-package and actual-user acceptance.

- Submission immediately clears the composer, which stays editable while a reply is pending. A failure restores the original text only if the field is still untouched; newer text, intentional clearing and an active Chinese input composition are never overwritten. Draft text survives ordinary status updates. Minimizing or hiding the window keeps the draft and pending reply; restore the window to read it. Switching companions or sources retires the foreground request and retains unsent drafts separately by account and source. Drafts are in-memory, not a promise of persistence after quitting. Removing the companion or clearing its credentials clears its drafts.
- A new desktop prompt supersedes buffered/active conversation under that engine's newest-message rules. On the channel source, incoming QQ conversation can likewise interrupt a desktop answer. The independent App engine and its history do not participate in that channel queue.
- Sending text ends only the selected account's already-owned desktop speech or QQ voice-rendering work. It does not start a microphone, speech model or playback. A later new voice intent cancels the pending text intent, so an old text setup cannot close a newly started voice session.
- Both App and channel sources keep voice collapsed until **Voice chat** is selected. Opening it checks the existing speech components; only **Start speaking / 开始说话** starts recording. App voice text and replies remain in the local App conversation, not QQ. A device check alone does not cancel a pending text turn. Text waits for an already-owned check/failed cleanup in its own account; it cannot silently bypass unconfirmed voice shutdown. The current installed package and source-only verification remain distinct in the active scope.
- Stop owns a specific local request. An old Stop/Close cannot cancel another account, a replacement panel, or a later request. Cancellation does not undo already saved conversation/memory changes or an already displayed reply.
- Existing typed local memory commands keep their behavior. Independent App voice transcripts remain conversation: spoken memory, publication, follow-up or permission commands do not execute those actions. Editing and confirming a transcript approves its wording, not an action; use the text composer or the App memory editor for explicit local memory management. The model receives no tool authorization; a permission string in a text prompt does not grant file/account access.
- The current model runners produce a response before its local bubbles are displayed; the interface does not claim token streaming. Model failure, cancellation and an ended reply stay distinct. An ended chat reply is not proof of a completed task.

## App reply notifications (limited preview)

Use **Settings → Notifications** with the existing quiet-mode preference.
When enabled, an App reply ending in the current conversation can show a silent
**Your App conversation has a new reply** notice. It contains no prompt, reply
or memory text. Existing foreground, quiet-mode, freshness and cooldown rules
apply; cancelled, failed or superseded replies do not qualify. Reply-end is
not proof of task success.

Clicking only restores and focuses the current application window. It does not
switch companions or sources, start AI/QQ, or interrupt newer work. If another
view is open, it stays open.

Two actual App turns completed, one during native minimization. Marked prompts
and replies remained in the selected App scope across eight App/channel stores.
The original notifications=false/quiet=false preferences were restored. No
Windows toast was captured by the two window checks, so **visible delivery and
actual toast-click behavior remain unverified**; this is not proof of suppression.
Windows registration prerequisites were checked without changing the system.
The package was explicitly delivered as a limited preview. Evidence:
`outputs/app-notifications-live-isolation-20261108.json` and
`outputs/app-notifications-delivery-20261108.json`.

## Verification boundary

### App image increment (2026-11-08)

Production checks passed **203 targeted tests**, **24 syntax checks** and
**752 stable inputs**. The production-renderer image suite passed **15 checks /
three screenshots / 88 stable inputs**; the existing send-key/draft suite passed
**13 checks / three screenshots / 87 stable inputs**. These cover selection,
replacement cancellation, removal, one-shot attachment IDs, late results,
scope changes, failure cleanup, image-caption command refusal and day/night
narrow layouts. They are bounded tests, not a new full-suite pass. The first
image UI run's focus assertion failed because programmatic focus did not trigger
keyboard `:focus-visible`; the corrected harness used actual Shift+Tab events.
The original failed receipt remains, and no product focus change was required.

In the original-profile `single-window-desktop-image-20261108` app, Ju/Claude API
and Whale/DeepSeek each completed one real image turn using the same original
synthetic test picture. Both replies correctly described the left-to-right
sequence: a red circle, a blue triangle and a green square. The native picker,
preview, explicit send and displayed replies were operated in the actual app.
Read-only SQLite checks found each caption/reply marker only in its selected
App scope, with the image placeholder; other roles and channel stores had no
trial marker. The two before/after process observations found no managed QQ
launcher and retained the same App main identity. These are two bounded model
flows and scoped storage/process observations, not machine-wide traffic
monitoring, universal image accuracy, billing verification or evidence of
long-term availability. Native Chinese IME remains untested.

Private evidence: `outputs/desktop-image-targeted-1794094173058/receipt.json`,
`outputs/desktop-image-ui-final-20261108/receipt.json`,
`outputs/desktop-image-shortcut-adjacent-20261108/receipt.json`,
`outputs/desktop-image-live-isolation-20261108.json`, and the actual reply
screenshots `outputs/desktop-image-live-20261108/ju-reply.png` and
`outputs/desktop-image-live-20261108/whale-reply.png`. The separate delivery
receipt `outputs/desktop-image-delivery-20261108.json` records seven actual UI
checks, three screenshots, original-account restoration and the desktop-entry
switch. App chat was paused and the original QQ source restored after both
trials. Dragon remains unstarted. Earlier failures and the remaining human
acceptance gates are unchanged.

### Send-key increment (2026-11-08)

In the previous `single-window-chat-controls-20261108` package, actual
original-profile use passed **six checks with five screenshots**. These key-send
flows were not repeated by the later idle-summary/contrast delivery.
With Ctrl+Enter selected, plain Enter kept a two-line draft without submitting;
Ctrl+Enter then sent it and a real DeepSeek App reply referred to both lines.
After selecting Enter, plain Enter sent a second prompt and a reply arrived.
The test ended with Enter selected, App chat paused and the original QQ
conversation restored. These were two intentional App model turns, not a
billing, sustained-availability or task-success acceptance. No QQ message was
sent by these test actions; that is not a machine-wide traffic observation.

The production renderer separately passed **13 checks / three screenshots /
87 stable inputs** for both sources, synthetic IME/repeat guards, draft and
focus preservation, pending replies, save failure and narrow night mode.
The combined **49 targeted checks** include 14 tests for deferred MCP dependency
loading; this is not a new full-suite pass. The same actual window opened the
79-byte, two-line local sample and formatted its JSON. Original fonts and theme
were retained. Native Windows Chinese IME and a real connected-channel key
submission were not exercised. Earlier failed runs remain preserved.

Private evidence: outputs/chat-controls-live-20261108/receipt.json,
outputs/send-shortcut-ui-20261108-final/receipt.json and
outputs/chat-controls-delivery-20261108.json. Resource measurements and their
unmet reference budgets are recorded in [the active scope](ACTIVE_GOAL.md).

### App memory editor increment (2026-11-08)

Production checks passed **134 targeted tests with 745 stable inputs** and
**12 renderer checks with four screenshots and 87 stable inputs**. These cover
scope/revision checks, stale results, cancellation and owned voice cleanup;
they are bounded checks, not a new full regression. Earlier failed full runs
remain preserved.

The actual packaged main, preload, registered IPC, renderer and SQLite were
then exercised with an isolated synthetic profile: **11 checks and five
screenshots** passed. The UI added a fact, corrected the same ID with a higher
revision, closed normally, reopened the same profile, read the corrected fact,
and explicitly forgot it. Independent read-only SQLite comparisons confirmed
the final deletion, selected App history/notes clearing and retention of an
unrelated local fact, another character's records and separate QQ sentinels.
Both launches closed normally; the exact wrapper and main processes were
independently absent, package inputs stayed stable and the temporary fixture
was removed. No key was saved and no AI executor, QQ session or model request
was started. Network/program denial observed no attempts from app-ready until
exit; it is not a claim of isolation before process startup or machine-wide.

The first packaged attempt failed in the harness's SQL comparison after the
UI had saved the fact. It compared raw `scopeFor` output with the database's
additional `SocialStore.scope` hash; its other-character comparison also
incorrectly selected empty arrays. Read-only inspection of the retained
synthetic database confirmed the intended records existed and did not change
its bytes. The original harness and failed receipt remain. The corrected
harness uses persisted scopes, requires nonempty one-fact/one-message/one-note
baseline sentinels, checks two selected facts after add/correct and one after
forget, and preserves all revision/history/isolation assertions. This was a
fixture correction, not a product memory-loss fix.

Private evidence: `outputs/app-local-memory-production-targeted-20261108/receipt.json`,
`outputs/app-local-memory-production-ui-20261108/receipt.json`,
`outputs/app-local-memory-live-reviewed-20261108/receipt.json` and the retained
`outputs/app-local-memory-live-20261108/receipt.json`.
This accepts actual packaged CRUD, normal-restart persistence and logical
scope isolation with synthetic data. It does not establish model recall,
physical erasure, abrupt-crash recovery or the owner's original memories.
Original-profile restoration is a separate delivery observation: the actual
new app showed QQ memory and an editable empty App-memory view, then returned
to Chats without changing its QQ source. No original memory was modified.
Ju and Whale each restored QQ/AI with one Start, with independent identity,
online/good and four unchanged vault hashes; no scan, key entry or model
request. Dragon remained unstarted. The desktop launcher now points to this
package; private evidence is `outputs/app-local-memory-delivery-20261108.json`.

### App voice increment (2026-11-08)

The operated local preview `single-window-app-local-voice-20261108` adds the
independent App voice entry described above. Current production checks passed
**184 targeted tests with no failures and 840 stable inputs**, **six syntax
checks**, and **21 renderer checks with 12 screenshots and 84 stable inputs**.
These cover local source/character/generation isolation, pending and failed
cleanup, transcript review, and voice commands remaining conversation. They
are bounded component/renderer evidence; no new green full regression is
claimed, and earlier failed full-run records remain preserved.

The original-profile Ju App voice panel opened before any managed QQ launcher
was running. Automatic and explicit capability checks returned the existing
neural provider and zh-CN; the microphone remained closed. Hide voice removed
the panel. Ju/Whale then recovered QQ and AI using their saved configurations;
four encrypted vault hashes remained unchanged and no scan or key entry was
needed. The desktop entry targeted that package at this earlier checkpoint. Evidence:
outputs/app-local-voice-delivery-20261108.json. These checks do not establish a new
microphone recording, model reply, audible playback or hands-free spoken
interruption. The earlier accepted manual neural voice flow remains separate;
the original human interruption gate is still unaccepted.

### Connected QQ history increment (2026-11-08)

In `single-window-ssqq-media-20261108`, the original Whale QQ conversation
displayed 60 saved articles, then90 after one earlier-page click. A second click
reached the earliest retained-record boundary; Return to latest restored the
original latest message. Switching to Ju reset to her own60-row history. At the
final boundary UI Automation returned only visible articles, so it did not
directly count all120. Independent SQLite readback verified Whale's120 retained
rows and unchanged message/action hashes across eight App/channel stores.
The same main/two launchers and four encrypted vault hashes were preserved.
No new model or message was used in this check. This is local retained history,
not a complete QQ server archive. UI checks with synthetic IPC separately cover
the exact60→90→120 behavior, stale binding and source changes.

Private evidence: `outputs/ssqq-media-actual-ui-20261108.json` and
`outputs/qq-saved-history-live-readback-20261108.json`; renderer evidence is
`outputs/qq-saved-history-production-ui-20261108/receipt.json`.

### App history increment (2026-11-08)

The actual App-history package was opened with the original home/profile.
The App conversation displayed the two previously saved local rows. This
reading made no new model request or outgoing QQ message. The original
profile did not contain enough App rows to exercise pagination. The two
previously configured companions were restored; separate read-only checks
confirmed their QQ identities, online/good status and four unchanged encrypted
vault files. No new key entry or scan was needed. These are point-in-time
observations, not a long-term availability claim.

Pagination was separately exercised in the actual packaged application with
an isolated profile and real SQLite containing synthetic records: **17 checks
and five screenshots** passed. Inserting 125 equal-timestamp rows retained
the latest 120; explicit reads expanded 30 → 60 → 90 → 120 in insertion order,
preserving the visible reading anchor. Paused history remained readable. A
normal restart retained the records but reset the visible window to 30;
switching characters kept their scopes separate. Both isolated runs closed
normally and their recorded processes were independently absent. No model
request or real account was used. The production-renderer suite separately
passed **10 checks with eight screenshots**, including stale responses,
forgetting, scroll behavior and day/night narrow layouts.

This increment's full regression reported **4,459 passes, three failures and
one optional skip** (4,463 tests). It was not green. The three failures came
from an outdated quoted-message fixture: it marked its synthetic QQ client
ready without supplying an open socket, so the current image-reference guard
rejected the input before the reader or model. Guarded reproduction confirmed
this mismatch; correcting the fixture preserved the real guard, original
budget and timeout. The fixture's five checks and a later **490-check targeted
run** passed. A new green full run after that repair is not implied. Historical
orphan failures and their unknown causes remain separate.

The launcher and delivery receipt were written, but the finalizer then failed
its last readback because a Windows relative path used backslashes. A separate
read-only check confirmed the written launcher, evidence hashes, shortcut,
wrapper and icon; the original failure was retained, without repeating the
mutation. Private evidence includes `outputs/app-history-actual-20261108.json`,
`outputs/app-history-live-native-20261108/receipt.json`,
`outputs/app-history-production-ui-20261108/receipt.json`,
`outputs/app-history-integrated-full-20261108.json`,
`outputs/app-history-repaired-targeted-20261108.json` and
`outputs/app-history-final-readback-20261108.json`.

### Earlier independent conversation acceptance

The independent App route was operated in the original home/profile with
`single-window-local-chat-20261108`. On 2026-11-08, Whale completed a real
DeepSeek API request for `ARCADE_LOCAL_20261108_C7F42A` using the already saved
key. At the pre-request observation, no managed QQ launcher was running. The
App displayed the exact expected reply. A read-only observation of the local
conversation scope found one matching prompt followed by one exact reply; the
QQ database contained no marker in that scope or any other scope. These are
bounded process, UI and storage observations, not proof of no network sends or
delivery across all services. The two databases were read in separate snapshots.

The same operated window preserved separate unsent drafts when switching
between App and QQ sources. Explicit App pause/start preserved App history and
its draft; the test drafts were then cleared without sending them. Day, night
and system appearance and the existing font family/sizes remain available.
This accepts one actual independent DeepSeek text flow and these local UI
transitions, not every provider, failure path, memory command or a long-running
session. QQ recovery and desktop-shortcut completion are recorded separately;
they are not accepted by this App-only test.

That earlier production full run reported 4,397 passes, five failures and one
optional skip; it was not a green full regression. Two parent failures and one nested
failure from an outdated fixture were corrected and followed by 423 passing
targeted checks. A separate PID-replacement fixture correction passed ten
checks. The original pending-orphan ownership failure remains unexplained;
one isolated pass does not explain or replace that failed full-run case. No
new full run after these fixture-only corrections is implied.

Temporary SQLite/provider checks additionally cover six admitted modes,
isolated history/memory, restart, cancellation, close retry and credential/
persona retirement with synthetic providers. Main IPC and full-renderer
checks remain component evidence. Private delivery receipts include
`outputs/local-chat-live-start-20261108.json`,
`outputs/local-chat-live-marker-20261108.json` and
`outputs/desktop-independent-validation-boundary-20261108.json`.
The historical real flows below used the connected channel-backed route.

The operated chat-refinement package on 2026-11-08 completed a real Claude API
round with immediate input clearing and a new draft entered while replying.
Computer Use confirmed the native window was minimized; scoped SQLite then
showed the reply completed after that action. Restoring the window showed the
completed reply and exact unsent draft, which was cleared without submission.
This accepts one pending-minimize/draft flow; actual provider-failure restoration
remains covered only by the isolated renderer checks. The earlier incomplete
attempt below remains its separate evidence.

The initial implementation has isolated actual-main IPC and full-renderer checks, plus a real temporary SQLite companion flow with a synthetic model. They cover pending setup, scope changes, stops, late results, no transport send, shared memory, polling drafts, IME, narrow layout and feedback.

On 2026-11-08, the original-profile desktop package completed one real Whale/DeepSeek text round. The app displayed desktop-origin replies; a read-only scoped database observation confirmed one local prompt and four local reply rows with the synthetic marker. The latest 20 owner QQ messages did not contain that marker. This bounded observation does not establish every provider, all historical/future QQ delivery, pending-minimize continuity or preservation of a newer draft. The response finished before the draft attempt, and UI control was yielded when user input was detected. Incoming QQ voice, recipient hearing and hands-free interruption remain separate unaccepted flows. The operated-package and real-flow records remain in `ACTIVE_GOAL.md` and `WORK_LOG.md`.


The subsequent UI-only polish aligns the selected App capsule with its local character and places Latest above the desktop composer. Production renderer14/11,28 adjacent cases and two syntax checks passed. Original-profile App/QQ switching retained the existing role; role changes and narrow/150% overlap were checked in the isolated renderer. The prior17-check packaged SQLite run was not repeated; backend bindings match. See the current delivery checkpoint for account restoration and retained full-suite failures.
