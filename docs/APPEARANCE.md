# Day, night and system appearance

The current package, runtime and remaining limits are tracked in
[the active delivery scope](ACTIVE_GOAL.md). The appearance behavior below was
verified in `single-window-appearance-quotes-20261108` and retained in the later
`single-window-appearance-invalid-20261108` checkpoint, including the independent
App conversation and earlier-message controls. These are dated evidence, not
the current package identity. The existing font family, per-element sizes and
original artwork remain unchanged. No public release is claimed.

## Controls

Open **设置 → 外观** and select **日间**, **夜间** or **跟随系统**. The preference
belongs to the application and is saved locally, independently of each
companion's account, API credentials and character. Follow system is the default
for an older configuration with no saved appearance preference. These controls
do not change the Windows theme. The radio group also supports keyboard use.

The observer's pixel-scene theme remains a separate setting. Changing window
appearance does not recolor portraits, source images, QR pixels or sprite art.
The existing font family and per-element sizes remain unchanged.

## Materials and page identity

Day uses milk-white and mist-pink surfaces; night uses warm gray-violet and soft
rose. Buttons, status colors, form fields, errors, menus and overlays have paired
foreground/background colors. Subtle inner highlights and restrained shadows
give surfaces depth while conversation text and code stay on plain backgrounds.

The chat uses ribbon/bubble linework; connections use linked points; work uses a
folded sheet and grid; activity uses a trail; relationships use interlaced rings;
companion management uses portrait frames; settings use dial-like arcs. The
QQ account page retains its approved flowers, dragon and whale decorations.
Artwork stays outside interactive controls and the QR quiet zone.

New decorations are original lightweight SVG/CSS. Public CC0 texture libraries
were reviewed, but no external texture download was adopted for this increment.
Existing original character and brand assets keep their existing attribution.

## Current installed Settings check — 2026-11-08 local

The later **single-window-builtin-offline-replies-20261108** package retains this
appearance implementation. Its actual Settings observation shows Follow system
in the current dark scheme, Enter sending and Ju selection after upgrade; the
new plugin preset panel uses existing styles and sizes. Its11 renderer checks
include wide light/narrow dark screenshots; no new all-page/theme-switch
acceptance is inferred. See the current scope and plugin guide for that delivery.

The actual **single-window-plugin-first-disabled-20261108** window passed three
checks/three screenshots: **Day** selected and saved, **Night** selected and
saved, then **Follow system** restored to the current dark scheme. Typography,
spacing and Settings ornaments remained; Ju/Whale connected indicators stayed
visible in the same main51160/window4133588. No Windows-theme, account, model,
voice or source change was made. Private evidence:
`outputs/appearance-current-20261108/receipt.json`. This is a bounded Settings
flow, not a repeat of every-page or actual OS-transition acceptance below.

## Verification boundaries

The latest appearance change, delivered in `single-window-idle-summary-contrast-20261108`,
changes the QQ voice composer's text color from the old ink token to the existing
text token. Two palette comparisons / four before-and-after screenshots showed
night contrast **1.258:1 → 12.653:1** and day contrast **11.671:1 → 13.665:1**,
with font, size, geometry and editability unchanged. The initial cross-VM object
assertion failure is retained separately from the corrected numeric checks.

In the actual original-profile night window, 20 typed characters were readable;
the panel closed without voice generation, playback or sending. The same window
retained Follow system and Enter after the upgrade. These four checks / two
screenshots include account restoration and are not audio or every-state
acceptance. Evidence: outputs/idle-summary-contrast-live-20261108/receipt.json
and work/appearance-readonly-gaps-20261108/comparison.json. The separate idle
measurement exceeded both resource reference budgets; see the active scope.

The previous appearance increment changes only three invalid-input border tokens
in QQ signature, group-name and member-card editors. Their more-specific CSS
previously overrode the shared palette. Using the existing error token raises
the measured dark border-to-paper contrast from **2.602:1 to 8.878:1**; the
light pair measures **6.314:1**. Fonts, sizes, line heights, weights, field
geometry and disabled-preview behavior are unchanged.

Six production-renderer cases across both palettes passed with 12 before/after
screenshots and 91 stable inputs. The three baseline files were reconstructed
by reversing the exact token and matching their original hashes; the after
states use current production CSS. These are synthetic form inputs in real
panel renderers, not edits to a QQ account. The prior App-voice 184 targeted
checks are retained without rerunning: package comparison verifies that only
these three CSS substitutions differ, with all other source and recorded test
inputs unchanged. This is not a new full-suite pass.

The implementation covers the full application shell, primary pages, shared
management overlays, compact layout and the bundled result viewer. The result
viewer retains its sandbox and offline CSP, receiving only an enumerated light
or dark host theme. This does not promise that arbitrary third-party MCP Apps
support theme changes.

The App-history delivery retains the existing appearance implementation. A
bounded current-source completeness review passed **15 checks with 15
screenshots**: seven existing preference/viewer checks and eight additional
compact, open-login, remote-form and component-panel checks. Both used the
production renderer with synthetic data; the system-event portion used
synthetic events. Eight key screenshots were independently inspected. No
product patch was needed. This is not exhaustive coverage of every dynamic
management state, Windows file picker, authentication dialog or third-party
MCP App. The App-history renderer separately checked its new controls in day,
night, narrow and scaled layouts as part of its ten-check/eight-image suite.

An earlier isolated full-shell review checked all nine real page renderers in
day and night modes (18 screenshots). It found two remaining color issues:
the selected QQ-installation badge and friend-request keyboard focus. Using
the existing theme tokens raised their measured night-mode contrast from
2.20:1 to 9.18:1 and 2.47:1 to 7.96:1 respectively, against the observed panel
background. These fixes change only colors, preserving fonts, layout and status
meaning. Three targeted states in both palettes were rendered before and
after the change; the same six-state check also passed against production
source. These are bounded checks, not every possible overlay state.

The production-source appearance suite also passed seven checks with seven
screenshots, covering saved preferences, keyboard focus, failure feedback,
narrow/scaled layouts and the sandboxed result viewer. These renderer results
remain separate from the operated-window observations below.

Source/renderer checks exercise preference persistence, save failure, system
theme events, keyboard navigation, narrow layouts and result-viewer updates.
Gallery data are synthetic and never perform account changes. Token-pair
contrast measurements and representative screenshots do not establish an
exhaustive audit of every dynamic state.

## Actual Windows transition — 2026-11-08 local

At that checkpoint, `single-window-app-local-memory-20261108` passed a bounded
live OS-change check in the same running main54300/window2495074. With **Follow
system** selected, Windows Colors changed from Dark to Custom (Windows Dark,
Apps Dark), then only the default app mode changed to Light. Agent Arcade
automatically displayed the light palette without restarting. Restoring
Windows **Choose your mode → Dark** returned the same app window to dark,
with Follow system still selected. Windows Settings was then closed; the
original main PID and creation time were independently read back.

Two App screenshots and the private receipt
`outputs/windows-theme-live-20261108/receipt.json` preserve the observation.
Ju and Whale still appeared connected in the UI; this check made no new model,
account or voice request and changed no application source. It covers this
Windows app-mode transition with the Settings page visible, not every OS
version, window state, high-contrast setting or a measured response-time bound.

## Earlier operated appearance check

In the actual `single-window-appearance-quotes-20261108` window, day mode was
saved and the QQ overview inspected, followed by night mode and then follow
system. The final preference is system, displaying the current Windows dark
appearance. Earlier-package testing separately confirmed that saved day mode
survived a normal restart; that restart check was not repeated in this round.
Windows itself was not switched during that earlier round, so it did not
verify live OS-change handling. The later bounded actual Windows transition
is recorded in the preceding section; it does not retroactively expand this
earlier check.
