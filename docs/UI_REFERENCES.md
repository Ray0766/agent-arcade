# UI references and design direction

Reviewed **2026-11-04** for the desktop workspace revision. The user asked for a less templated interface informed by award-winning work, published HCI research, and the official ChatGPT, Gemini and Claude interfaces. This is the evidence and translation record; implementation checks belong in [VALIDATION.md](VALIDATION.md).

## Independent App conversation, 2026-11-08

This increment extends the previously inspected references rather than claiming
a new visual study. Gemini's clear first action informs **Chat in App** beside
saved AI setup; NapCat Desktop's contextual account actions inform a small
source selector inside the existing character conversation. A second account
dashboard was considered but would duplicate navigation. The selected approach
keeps one character list, an App/channel choice and the existing composer.
It does not inherit either reference's account permissions or conversation
semantics, and no reference artwork or UI source is copied.

Keep the original typography, mist-pink day palette, warm gray-violet night
palette and subtle chat linework. Source choice must change both displayed
history and availability: QQ being disconnected must not label an available App
conversation disconnected. Paused/failed local cleanup must retain a reachable
retry in the page where it occurred. Separate unsent drafts and honest source
labels matter more here than new decorative controls. Full-renderer images and
actual application acceptance remain distinct evidence in the active scope.

## First local result and remote copy, 2026-11-07

The subsequent ZIP extraction action keeps the same selected-object workflow.
The source archive, chosen destination, counts and confirmation stay above the
technical disclosure; interruption and collision behavior remain visible. This
uses the previously inspected NapCat Desktop's contextual-action principle and
Things' quiet hierarchy below, rather than importing either product's artwork
or archive semantics. The archive's top-level paths stay reviewable and are not
silently flattened. The Chinese wide preview, English 430 px preview and partial
outcome screenshots were opened and inspected. No font, size, global CSS or
brand asset changed, and no comparative usability improvement is claimed.

These are extensions of the established design, not a fresh visual direction.
The inspected Gemini entry below supplies one useful principle: a clear first
action before settings. Here a secondary **Try a local sample first** action
opens the real local inspector; it does not pretend an unconfigured companion
can chat. The previously inspected NapCat Desktop imagery supplies compact,
contextual account actions; copy adapts that principle to selected-file actions
and existing target-directory/preview flow in the same window. No upstream UI
code or artwork is reused, and its operation semantics are not inferred from
those screenshots.

Keep the existing font stack, 17 px section headings, 14 px body text and
mist-pink controls. The copy preview distinguishes prepared content from a full
directory snapshot; its result keeps partial acknowledgements and later byte
observations separate. A sample error returns an explicit retry in Work &
results. Production-DOM sample checks use the real Workbench/MCP service and
cover narrow Chinese/English, keyboard focus, retry and formatted output;
packaged checks are recorded separately in the active goal.

## QQ login overview and scan dialog, 2026-11-06

After comparing a list/detail draft and other generated directions, the owner
selected **concept 02: an account-card overview with a centered scan dialog**.
The cards retain the multi-account overview; the same-window dialog focuses the
chosen account's login action. The conversation and other application entry
points remain in the existing shell. Earlier list/detail checks describe that
draft, not acceptance of this newly selected presentation.

| Visually inspected reference | Borrowed principle → project translation | Not transferred |
| --- | --- | --- |
| [NapCat Desktop v3.5.19 official README](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/README.md), its `docs/assets/screenshots/apps.png` and `chat.png` images | Compact account identity, a narrow rail and local action groups → original character cards with an explicit, account-bound scan dialog. | These are official browser-preview screenshots with demo data, not an observed real login workflow. Dense equal-weight action rows, pop-out windows, artwork and upstream UI code are not copied. |
| [Things official interface image](https://culturedcode.com/things/2024-01-20/images/whatsnew-collage-io60.png) | Aligned navigation, a clear current task and quiet secondary metadata → restrained separators, readable account details and collapsed configuration/diagnostics. | Static official imagery, not hands-on product use. macOS chrome, task checkboxes and completion semantics do not describe QQ login or AI success. |

Six generated logo studies and five generated login concepts informed the
comparison. They are visual proposals, not working controls, genuine QR codes
or evidence of login success. The interactive DOM draft retains the project's
original portraits and real operation contracts. The owner retained **misty
pink** and selected **logo 06, the pink ribbon**, refining its openings into
negative-space chat-bubble and bot silhouettes. The added colored symbols in
variant 07 were rejected; variant 08 explored that cutout direction, without
becoming a final approval. After the owner found variant 11's bot too prominent
and complex, simplified variant 12 was shown and retained as a reversible preview
candidate for the next package, without final owner approval. Blue remains a
comparison variant, not the default; variant 12's asset checks and packaged
presentation are still pending.

Local QQ account selection is independent of AI profile selection. Runtime
ownership, QQ login and AI connection stay distinct. The QQ page hides the
duplicate top AI-companion strip while other pages retain it; this local
presentation change does not change the selected AI profile. Advanced configuration,
backups and recovery remain reachable. Start and Show QR remain explicit;
closing the scan view clears its QR, without logging out or stopping QQ.
Synthetic draft checks and inspected screenshots establish only the tested
draft's behavior. Formal UI source has reached a checked checkpoint; the revised packaged whole-app
flow and real QQ acceptance have not yet been verified. No comparative
usability, award or superiority claim is made.

## Single-window companion room, 2026-11-06

### Component version drawer

The component workflow extends the already inspected NapCat Desktop account
identity and Things aligned-row references below. A full update dashboard and a
same-window detail drawer were compared. The drawer keeps the account page as
the daily entrance and uses one ordered task: prepare a fixed official version,
review its scope, then save the next-start selection. Orange marks the current
action, with quiet separators and readable version text instead of decorative
statistics or an invented progress percentage. The original character artwork
stays on the account page rather than inside the technical operation.

The drawer retains the existing Chinese font fallbacks, 8 px spacing rhythm,
warm paper surface and visible focus treatment. Its header and status remain
visible while the content scrolls. A prepared record, integrity verification,
saved component selection, running QQ and successful login remain distinct.
For download/preparation, closing the drawer is not cancellation; an explicit
cancel control is shown during those operations. The newer pending-update
inspection revokes its one-use preview on close and cancels unfinished checks.
These references guide hierarchy and density, not
copying an upstream updater or claiming a measured usability improvement.

The owner now explicitly asks for NapCat-like warmth and a single application entry. Two directions were considered: an account-management dashboard with equally prominent cards, and a conversation-led shell with account management as an ordinary page. The latter keeps the everyday conversation readable while giving QQ startup, QR login and recovery a stable place. It preserves the existing original anime portraits, relationship features, provider settings and observer views; it does not introduce a second application window for account management.

| Inspected reference | Specific observation and principle | Translation here | Boundary |
| --- | --- | --- | --- |
| The owner's actual NapCat Desktop screenshot in this conversation | Warm off-white surroundings, a narrow icon rail, orange selection and one prominent confirmation action make the account operation easy to locate. | A 72 px rail, warm neutral shell, terracotta selection/action color, and a normal QQ account page. The character portraits remain the strongest identity cues. | The screenshot shows a configuration-conflict state, not a complete interaction study. We do not copy NapCat artwork, icons, layout source or its conflict workflow, and do not infer an award or measured usability advantage. |
| [Things official features page](https://culturedcode.com/things/features/) and its [official interface image](https://culturedcode.com/things/2024-01-20/images/whatsnew-collage-io60.png), visually inspected again on 2026-11-06 | Quiet navigation, aligned rows, clear project titles and local controls let content carry the hierarchy. | Relationship records use separated rows; companion management uses aligned identity and action groups. The conversation stays a reading column instead of a grid of feature cards. | This was an official static screenshot, not authenticated product use. Task checkboxes, completion semantics, macOS chrome and multiple windows do not transfer to a companion conversation. |

The type system uses local Segoe UI Variable / Segoe UI with Microsoft YaHei UI fallback: 14 px body text, 17–18 px section titles and 26 px page titles. The 8 px spacing rhythm supports both concise account rows and a relaxed conversation. Core colors are paper `#fffdfa`, shell `#f6f3ee`, text `#302b27`, muted text `#736c65`, separators `#e7e0d7` and action `#b94a25`. Status still has visible text; color does not identify a model provider or prove a connection.

At narrow widths the existing page picker replaces the rail, the companion strip scrolls horizontally, and account controls wrap into one column. Keyboard focus uses a visible two-pixel action outline; reduced-motion preferences disable decorative transitions. Conversation, private relationship controls and QQ diagnostics retain their existing IDs and IPC contracts. The inspected Things image is retained only as a local reference in ignored outputs; no reference artwork or font is bundled. These are design decisions to validate through rendered screenshots and the existing flows, not claims of a comparative usability improvement. Earlier dated directions below remain historical records.

**Renderer checkpoint, 2026-11-06:** the isolated fixture run passed 36 checks and produced 18 screenshots, including the original relationship flows, the account page, QQ cards, recovery, pending operations, a failed QR refresh and Chinese/English 430 CSS px layouts. The key final screenshots were opened and inspected. A failed QR refresh now clears its previous image instead of leaving a stale code visible; pending work has explicit feedback, and changing language clears old localized feedback. A last-verified companion association is labeled separately from live QQ status, and current identity takes precedence. Visible-page polling runs at ten-second intervals without overlapping requests; unchanged results preserve focus and QR, while a changed or unknown runtime identity or completed login removes the code. The polling checks use a virtual clock, not real QQ traffic. Inline account creation requests only a QQ number and lets the backend choose a port. Per-account configuration requires an explicit choice among multiple existing servers; binding chooses an existing companion and owner, requires the AI to be disconnected, and does not connect or invoke a model. The fixture checks cover port failures, a saved configuration with failed status refresh, an unconfirmed credential rollback, draft/focus retention and token canaries absent from the DOM.

The run is reproducible with `ARCADE_UI_PREFIX=companion-qq-config-20261106-final2` and `ARCADE_UI_QQ_RUNTIME=1` when invoking `scripts/companion-nine-ui-smoke.cjs`; its local report is `outputs/companion-qq-config-20261106-final2-ui.json`. The fake QR is visibly marked nonfunctional. These fixtures use no live models, messages or posts and do not establish live QQ runtime migration or login acceptance. Selected palette checks measured 5.16:1 for white action text and 4.63:1 for action text on the selected background; this is not a full accessibility audit.

**Entry-point correction, 2026-11-06:** checking the running build exposed an inconsistent first step: conversation settings still foregrounded external installation and manual token copying. When the integrated QQ runtime API is available, both conversation settings and connection onboarding now open the QQ account page directly. Their copy explains that saving a companion binding is followed by an explicit connection from Manage companions. The original manual controls remain under a closed Advanced section with their IDs and actions retained; older environments without this API keep the existing route. Opening management does not change the AI backend, save credentials or connect an account. The final isolated run passed **39 checks / 23 screenshots**, including both entry points, connected/disconnected states and Chinese/English 430 CSS px layouts. Its report is `outputs/companion-qq-entry-20261106-final-ui.json`, reproducible with the same smoke script and `ARCADE_UI_PREFIX=companion-qq-entry-20261106-final`, `ARCADE_UI_QQ_RUNTIME=1`. The Chinese wide drawer and English narrow drawer/onboarding screenshots were opened and inspected. Source fixtures enter `main.cjs` with a fresh profile so they do not contend with the owner's running window; they do not test the production global single-instance bootstrap or real account operations.

**Private backup controls, 2026-11-06:** these follow the same local-action principle:
each QQ card keeps a closed Configuration backups section, a deliberate
selection/preview step and a single restore action. The redacted preview shows
changed connection fields rather than raw JSON or secret values; restored-file
receipt and status-refresh failure remain distinct. The isolated run at
`outputs/companion-qq-backups-20261106-ui.json` passed 41 checks with 26 screenshots;
Chinese wide and English narrow backup previews were opened and inspected. It
uses no real account files or model requests. See [backup boundaries](QQ_PROFILE_BACKUPS.md).

**QQ first-screen density, 2026-11-06:** a running-build review showed that the
component block and empty creation section pushed account controls too far down.
The component version is now a compact expandable information row; its path and
folder picker remain inside. The adjacent Add account disclosure opens the same
form without reserving an empty section. Account cards use a three-column row at
900 CSS px where space permits, keeping identity, status and start/stop together.
The isolated `outputs/companion-qq-density-20261106-ui.json` run passed **42 checks
/ 28 screenshots**. Viewport screenshots at **1200×830** and **900×640** were
opened and inspected; all three cards' first start/stop buttons were within the
viewport in the normal collapsed state, even with the fixture banner present.
Expanded settings, warnings, additional accounts and narrower windows can still
require scrolling. Component disclosure state survives refreshes; English and
Chinese 430 px flows remain covered. No backend or account operation changed.

## Chat-led revision, 2026-11-04

### Read-only QQ directory addition, 2026-11-06

The same NapCat account identity and Things row-alignment references above are
reused for the new directory. An additional card grid would obscure a list that
users scan by name/remark/number; the selected account instead opens a single
right-side drawer with a stable identity header, two tabs and separated rows.
It uses existing warm-neutral tokens and local system fonts, without remote
avatars, extra decoration or a second window. The drawer becomes full width on
narrow displays. Short counts and a read timestamp explain the current result,
not a live-service or completeness claim.

The isolated run `outputs/qq-directory-20261106-final-reviewed-ui.json` passed
15 checks and generated five screenshots. Chinese wide/narrow, English narrow
and error views were opened and inspected. Native dialog focus initially caused
its header to scroll out of view during resize; clipping the outer drawer while
keeping the list separately scrollable preserves account identity and Close.
Escape, roving keyboard tabs, visible focus, 50-entry pagination, long names,
reduced motion and stale-request rejection were exercised. The broader fixture
still passes 42 checks / 28 screenshots at
`outputs/qq-directory-regression-20261106-ui.json`. These are synthetic renderer
checks, separate from the real direct-reader observation and pending packaged
drawer acceptance. See [the directory guide](QQ_DIRECTORY.md).

### AI-first connection entry, 2026-11-05

The current entry is a single progressive page: select an original companion, choose local login or API key, then connect a chat channel. A multi-page modal wizard was considered, but the single page lets the user change provider without losing the channel context. It retains the light conversation-room palette and system Chinese font fallback: 22px page title, 16px section titles, 14px text and an 8px spacing rhythm. Three distinct portraits identify the AI choices; appearance and future integrations are secondary disclosures.

This reuses two previously inspected references below: Claude's public login surface contributes a focused next action, and Gemini's public entry contributes a quiet surrounding navigation. The translation is a provider-specific account section followed by channel actions, rather than copied brand styling or a pretend chat composer. The CHI 2019 relevance guideline informs showing only the selected provider's prerequisites. These are design hypotheses, not a measured usability advantage. Original CLI login, saved API key, chat transport connection and validated work remain distinct states. No claim is made that DeepSeek exposes consumer-account login or that ClawBot is a personal WeChat friend.

**Later owner direction:** a light anime conversation room, with multiple messaging services and AI backends as the product direction. At that design checkpoint, the implementation was WeChat and the two Claude paths. The later [QQ/Codex/DeepSeek revision](CHANNELS_AND_AI.md) extends the same navigation and identity separation; current local and live acceptance boundaries are recorded separately. Navigation now says Chats; Connections separately lists messaging channels, execution backends and companion appearance. Unimplemented entries are labeled planned and have no connect action. A model API is not automatically a local execution agent.

The local Bothouse checkout (commit `920f176b281399490a6c966a29ea90341b577bf3`) was inspected: its team illustration and five avatar files show distinctive anime identities, while its architecture separates a role from its backend. We borrow readable portrait crops and that identity separation. We do not copy its team arrangement, Discord avatar files, automatic-permission defaults, or imply an implemented Bothouse integration. Avatar source notes did not establish individual redistribution rights. The new [Sprout portrait](../src/ui/portraits/README.md) was generated independently with the built-in image tool, retaining the original green/amber identity; its full prompt and provenance are recorded. The owner selected the light direction over a dark club-room layout. Pale lilac surfaces and mint portrait backgrounds add character without a full-screen illustration or ornamental dashboard.

The owner rejected the working-desktop revision below and explicitly chose a refined chat interface with the character as a small accent. A scene-led workspace would emphasize the original premise; a chat-led workspace puts the current WeChat workflow first. The owner's selection resolves that tradeoff. The earlier reference inspection remains applicable, but a generic sidebar and lighter colors alone did not satisfy the design brief.

The new composition uses a 76 px navigation rail, a readable conversation column and an optional connection inspector. One conversation header replaces repeated breadcrumb/page/conversation titles. User messages are right-aligned bubbles; assistant replies are open text. A small original Sprout avatar preserves identity without occupying the reading area. The UI uses Segoe UI with Microsoft YaHei UI fallback, 14 px conversation text and an 18 px title, neutral surfaces and a muted blue action color. Color is secondary to visible state text.

This adapts Gemini's focused central operation and the official chat illustrations' separation of navigation and conversation; Things' restrained navigation informs the narrow rail. The scope of those reference observations is documented below. We do not transfer promotional heroes, copy brand artwork, or claim a measured usability improvement.

Connection configuration is available beside the conversation and becomes a normal full-width section in narrow windows. Its toggle and Escape handling return keyboard focus to the opener. Ordinary state polling does not close a manually opened inspector. New messages follow the bottom only when the reader is already there; otherwise a visible latest-message action preserves their reading position. Replies can be copied explicitly. Message text remains text, including HTML-shaped content. Only existing message timestamps are shown; native messages currently have no timestamp field.

The desktop remains a view of the WeChat conversation, with a plain instruction identifying ClawBot as the input surface. There is no pretend desktop composer. Native connection observations and independent hook sessions remain separate. The API/local entry points, original themes and permission boundaries remain in effect. UI screenshots are synthetic fixtures and do not establish a new live WeChat acceptance run.

## Direction: a workspace with a small scene

Two directions were considered:

- **Immersive scene:** make the animated world the entire interface and put controls around it. This preserves the toy-like first impression, but makes conversations, connection recovery and configuration harder to scan.
- **Working desktop:** use stable navigation and a clear content area; keep the original character as feedback for the selected session and in the session overview. This supports daily use without discarding Sprout Bot or the two original themes.

Choose the working desktop. The scene still communicates observed state, while conversation and session content establish the hierarchy. A large welcome slogan, decorative metrics and repeating setup cards do not help an already-connected user continue working.

The revision's concrete rules are:

- Use a gray/white application shell with local system fonts, 13–14 px body text and a roughly 20 px page title. Color primarily marks state, selection or a deliberate action. These are project choices, not values proved optimal by a paper.
- Keep WeChat, Sessions, Activity and Settings in predictable navigation. Preserve a compact navigation path and keyboard focus.
- In connected WeChat mode, put the conversation first and collapse connection settings. Before connection, show three real steps: pair WeChat; choose project/execution method; start receiving tasks. Do not imply pairing itself starts a task.
- Remove decorative metric cards. Keep task names, state labels, latest observed facts and timestamps aligned and readable.
- Keep diagnostics in expandable details. Keep permission requirements and actionable failures visible when relevant. Ordinary replies should read as conversation, without a repeated transport receipt or fixed result prefix.
- Preserve explicit state semantics: a reply or `Stop` boundary does not independently verify task success; disconnecting forwarding does not stop the local CLI. See [ARCHITECTURE.md](ARCHITECTURE.md) and [WECHAT.md](WECHAT.md).

## Awarded productivity references

The award organization establishes the award status. Current product screenshots establish only what was visually inspected now; they are not evidence that the same version won years earlier. Neither product was installed or evaluated hands-on in this review.

| Reference and verification | Specific observation → principle → project translation | Boundary |
| --- | --- | --- |
| **Things 3 — Apple Design Award winner, 2017.** Listed in [Apple's official winner announcement](https://www.apple.com/uk/newsroom/2017/06/apple-design-awards-celebrate-the-best-in-innovation-and-creativity/). The [current product screenshot](https://culturedcode.com/things/2024-01-20/images/whatsnew-collage-io60.png) and [features page](https://culturedcode.com/things/features/) were opened and inspected. | A quiet sidebar establishes location and grouping; the main area presents the selected project. Heading weight, row alignment and secondary metadata do more work than containers. Apply a stable session list, one selected content area and restrained separators; place extra detail near the object that needs it. | This is a mature reference, not a recent award. Do not copy macOS controls, pale low-contrast text, task-planning features or completion checkmarks. An observed response boundary must not inherit a task manager's “completed successfully” implication. |
| **Craft Docs — People's Voice Winner, 2024, Webby Awards, Apps, Software & Immersive / Work, Productivity & Collaboration.** Verified in the [organizer's category gallery](https://winners.webbyawards.com/winners/apps-software-immersive/software-services-platforms/work-productivity-collaboration). This is **not** the jury's Webby Winner distinction. The [official site](https://www.craft.do/) and its [current desktop screenshot](https://www.craft.do/_image/width%3D3840%2Cquality%3D85%2Cformat%3Dauto/_next/static/media/hero-screenshot-desktop-full-new.7dbb6bd9.png) were inspected. | Space navigation remains fixed; the current collection has a clear title; view, sort and search tools gather beside its content. Apply a stable workspace shell, content-first titles and one local toolbar instead of controls scattered across setup cards. | The colorful masonry previews support document browsing. They are unsuitable as a literal template for a status monitor that needs aligned scanning and stable positions. The current screenshot is not asserted to be the 2024 award version. Craft's 2021 Apple Design Awards listing was a finalist, not an Apple winner. |

These were selected for the everyday work they organize, rather than for an immersive promotional effect. Awards are a reference-selection signal; they do not establish that importing a pattern improves this product.

## Official AI product surfaces

The review team opened the following public pages in a fresh browser and visually checked their visible states. No message was sent, no authenticated conversation was tested, and no private history or account content was saved. Product shells, login pages and marketing pages are deliberately distinguished.

| Surface actually viewed | Observation → useful translation | What is not transferred or established |
| --- | --- | --- |
| [Claude product overview](https://claude.com/product/overview) | A serif-led promotional heading is paired with product examples. Examples make a capability concrete; Agent Arcade should explain an unfamiliar connection with one relevant example near setup. | The large promotional hero is a marketing device, not a template for the daily desktop workspace. Do not copy its serif branding, expansive spacing or wording. |
| [Claude public login](https://claude.ai/login) | A light surface separates a focused sign-in operation on the left from imagery on the right. The useful principle is one clear next operation before entry. | Login is not the authenticated chat interface. No conclusion about Claude's full chat workflow follows from this page. Agent Arcade does not need a decorative image beside every form. |
| [ChatGPT official Chinese overview](https://chatgpt.com/zh-Hans-CN/overview/) and its official app illustrations | The overview uses a dark, oversized promotional hero. Its product illustrations make a distinction between navigation, conversation and the work being produced. Keep conversation legible and put its actions beside it. | The hero's scale and marketing sections should not consume desktop working space. The illustrations are demonstrations, not a logged-in interaction test. No feature or usability comparison was performed. |
| [Gemini public app entry](https://gemini.google.com/app) | The visible dark empty state gives the central Ask Gemini area priority and keeps the sidebar visually quiet. Before a first task, one obvious starting point is more useful than equal emphasis on all settings. | The page was viewed without sending a message. The dark palette is not a requirement; no authenticated features or task performance were tested. Agent Arcade must show actual prerequisites when input is unavailable instead of displaying a nonfunctional composer. |

The common project inference is to reduce competition around the current operation. It is not a proposal to copy one brand's palette or combine three brands' visual signatures.

## Research used for interaction decisions

These are published HCI papers, **not paper.design references**. Both are established work; neither is presented as a new 2026 result. They support decisions about information, explanation, control and interruptions, not a scientific prescription for colors, corners or typography.

### Amershi et al., CHI 2019

*Guidelines for Human-AI Interaction*, DOI [10.1145/3290605.3300233](https://doi.org/10.1145/3290605.3300233). The [author-hosted paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf) was read, including its 18-guideline table. It reports iterative evaluation with design practitioners and existing AI products, not a trial of this application.

- **G4, relevance:** show connection instructions before connection, conversation after connection, and diagnostics on request.
- **G11, explanation:** expose the observed event and uncertainty behind a character's state. A mascot's action cannot substitute for that evidence.
- **G17, global control:** keep notification, quiet-mode and observation preferences discoverable. Distinguish pausing forwarding from stopping the CLI.

These are adaptations of the guidelines, not evidence that the new layout will be faster or preferred.

### Iqbal and Bailey, CHI 2008

*Effects of Intelligent Notification Management on Users and Their Tasks*, pp. 93–102, DOI [10.1145/1357054.1357070](https://doi.org/10.1145/1357054.1357070). Bibliography and abstract were checked through the [authors' lab publication list](https://orchid.cs.illinois.edu/publications/index.html) and [University of Illinois research record](https://experts.illinois.edu/en/publications/effects-of-intelligent-notification-management-on-users-and-their/). The DOI resolver returned an access error in this review, so full-paper inspection is not claimed.

The study examines notification delivery at user-task breakpoints rather than immediate delivery. It motivates treating notification timing and content relevance as design questions. Here that means preserving opt-in alerts, focus suppression, cooldown and a persistent scene the user can inspect voluntarily.

An **agent event boundary is not a measured breakpoint in the user's attention**. This app does not infer the user's mental workload, and this paper does not validate its cooldown duration or prove that its notifications reduce interruptions. A comparative test would still need to measure correct session identification, missed intervention requests, notification count and disruption in the user's actual work.

## Evidence and asset boundaries

- Linked pages, award records and the research PDF/abstract were checked during this review. Login availability, current app content and third-party assets can change; a link is not a versioned test fixture.
- Product images were inspected as reference material only. Temporary reference downloads were not added to the repository. No reference fonts, screenshots, icons, characters or marketing copy are shipped with this revision.
- Sprout Bot, Moss Workshop and Lunar Post remain the project's original assets. Local system font fallbacks avoid a new font distribution dependency. Code and asset licensing remain documented in the project [README](../README.md) and [LICENSE](../LICENSE).
- Screenshots and functional checks of Agent Arcade should verify both languages, narrow/compact layouts, keyboard focus, reduced motion, connected/unconnected states and actionable errors. This reference review itself does not establish accessibility conformance, improved efficiency or a successful WeChat acceptance run.

## Brand symbol: shared contours, 2026-11-06

**Guild of Food Writers Logo — D&AD, 2006, Branding / Logos & Typefaces.**
The [organizer's current archive](https://www.dandad.org/work/d-ad-awards-archive/guild-of-food-writers-logo)
labels it **Wood Pencil**, not Yellow/Black Pencil. This is a classic reference,
not a new award. The [official artwork](https://cms.dandad.org/images/IHx4afBxQCjBNUEyRWDibjKE3bU=/111325/width-1600/3000x2400-inside_Z4GKJ0G.jpeg)
was opened and visually inspected: a white spoon shares the black pen nib's
central opening and slit. One boundary communicates both subjects.

The project translation is to explore one ribbon silhouette whose negative
space combines a speech bubble and bot, using a shared contour rather than two
complete small icons. We borrow that structural method, not the nib/spoon
artwork, proportions or formal black styling. Our warm companion identity and
square 16–32 px icon require their own legibility checks; the large reference
does not validate them. Generated candidates remain original design attempts,
not award-level claims. The reference image is retained only in ignored local
research outputs and is not an application asset.
