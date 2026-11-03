# UI references and design direction

Reviewed **2026-11-04** for the desktop workspace revision. The user asked for a less templated interface informed by award-winning work, published HCI research, and the official ChatGPT, Gemini and Claude interfaces. This is the evidence and translation record; implementation checks belong in [VALIDATION.md](VALIDATION.md).

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
