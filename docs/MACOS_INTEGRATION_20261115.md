# Integrated macOS candidate — 2026-11-15

This execution integrates the original repair snapshot and the eight local
adoption-readiness commits into `codex/integrated-macos-20261115`. It does not
publish a release, operate an owner profile or accept real-model quality.
QQ is not expanded and 3D remains later.

## Inputs, preservation and integration

The original workspace was `codex/mac-update-retention` at
`3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`, with 75 modified/untracked paths.
The preparation workspace was clean at
`24fce66763bd8de8e2ea74877e31512d8c4f0500`. They remain separate workspaces.
Before writes, both states, diffs, file hashes and existing Git histories were
recorded. The recovery snapshot contains per-path bytes (including untracked
source/tests/docs), worktree/index diffs and Git bundles. It contains source,
not owner runtime profiles, API keys or chat data, and is not committed.

The input captured at 21:27 AEDT is the explicit scope; later parallel changes,
if any, remain in the original workspace and are never silently overwritten.
Final preservation checks will report observed differences rather than assuming
all hashes unchanged. The original AGENTS.md bytes were retained unchanged;
no authorization or acceptance rule was rewritten.

Original repairs were imported byte-for-byte in four reviewable groups:

| Group | Paths | Import commit |
| --- | --- | --- |
| App context, Wiki and notices | 18 | `b1c67b493f49f41b29e394074d06cee4714a228e` |
| Task/worktree recovery and native process cleanup | 12 | `bd9573a1618a6bb7cddeb5dfda040fc7827e7e0a` |
| Mac identity, backup, credentials, persona and shared wiring | 29 | `d318a3186e9cc54e9ebbbd5b6a04ea69eb557bae` |
| Existing documentation and instructions | 16 | `090e0fc45b620fc056fdcaf495ad505a96dc6274` |

Preparation commits were then cherry-picked in their original order:

| Preparation | Integration |
| --- | --- |
| `11963fe` | `05a3b59` |
| `4a95a19` | `387d7e7` |
| `f46f20e` | `8984e57` |
| `4355439` | `c50e19c` |
| `4f20b3f` | `14636bc` |
| `323ee14` | `63256a0` |
| `78ce141` | `d8a6df9` |
| `24fce66` | `8785834` |

Only the third cherry-pick conflicted: README.md (5 hunks), README.zh-CN.md
(2), docs/RELEASE.md (3) and docs/VALIDATION.md (2). Reviewed conflict hunks use
the later bilingual source/version/acceptance and CI wording; non-conflicting
content from both sides is retained. No whole-file side selection was used.
The package scripts preserve the Mac wrapper and add both readiness checks;
the prepared minimatch override and lock remain. Historic reports retain
their own time and evidence scope; this document records the integration.

## Candidate and verification plan

Candidate version is **0.4.0-preview.2**, local and unpublished. The public
remote `3edf1ce` baseline remains `0.4.0-preview.1`; neither that pinned source
nor the old public Windows preview is relabelled as this candidate.

Before building: complete integration audit, targeted credential/backup/scope,
context/notice/streaming, task/POSIX and build-consumer checks, fixed cases,
then one full regression, syntax, first-use/release checks and dependency audit.
An M09 lexical synonym exploratory gap is reported separately from required
cases. Earlier 4963/5000 totals are historical, not this execution's results.

Build only from a committed clean worktree using the existing `dist:mac` entry,
explicit arm64 and its `--publish never` policy. Build output and caches stay
outside iCloud Desktop. Generated icons derive from the tracked approved
brand source; no old package is substituted for the new artifact.

The final receipt will separately identify the full build-source commit and
any later evidence-only commit, environment, version, arch, artifact path/size/
SHA-256, archive/source match, signature and notarization state. It will also
record DMG/ZIP structure and extracted-App checks and a script-driven synthetic
run of actual packaged code under a separate test identity/profile. The owner
App must not be focused, closed or replaced by these checks.

Actual command results, artifact identity, screenshots and final preservation
checks are appended after execution. Pending is not a pass. Real provider/key,
native permission/IME/notification/sleep, installation and external-user gates
remain in [ADOPTION_TRIAL_KIT](ADOPTION_TRIAL_KIT.md).
