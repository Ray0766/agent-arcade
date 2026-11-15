# Candidate identity and evidence — 2026-11-15

This is a tracked, sanitized status summary. It does not publish a package or
turn maintenance records into independent/human acceptance.

## Current local integration

The later integration worktree now combines the 75-path repair snapshot and all eight preparation commits as local version `0.4.0-preview.2`. See [the current integration report](MACOS_INTEGRATION_20261115.md) for new source/build/evidence identities. The historical rows and earlier test records below describe the preceding capture and preparation branch; their “not integrated” statements do not describe the new integration branch. No public download or release is created.

## Which product can someone obtain?

| State | Identity | Availability / evidence boundary |
| --- | --- | --- |
| Published preview | `v0.3.0-preview.2`, target `fd81d161ac1f8417a237aeddf166d7717fb449df` | Old Windows observer/task preview; not the App-first candidate. [Public assets](https://github.com/Ray0766/agent-arcade/releases/tag/v0.3.0-preview.2) rechecked read-only on 2026-11-15. No public Mac candidate asset was found. |
| Committed development baseline | `codex/companion-nine` at `3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`, package `0.4.0-preview.1` | Exact public source entrance in [FIRST_RUN](FIRST_RUN.md). A developer candidate, not evidence of a successful real first reply. |
| Existing local repair candidate | Same Git base, branch `codex/mac-update-retention`, **75 uncommitted paths** frozen 2026-11-15 18:29 AEDT | Local Mac App only; source includes later companion, storage and Mac fixes. Not downloadable from Releases. Its version string alone is insufficient identity. |
| This adoption-readiness branch | `codex/adoption-readiness-20261115`, starting at the committed baseline | Independently reversible preparation commits. **Does not integrate those 75 repairs.** Do not infer that its App code has the local candidate's behavior. |

The report's 48/57-path observations described earlier checkpoints. They are not
repeated as today's count. The original checkout's branch/index/files remain
untouched by this execution. New preparation files live in an independent worktree.

## Static identity checked in this execution

[Machine-readable manifest](evidence/candidate-20261115.json), schema 1:

- Code tree SHA-256: `35cabe89d278abbafbd77157319e9356f662b3b3c9864daf4828dc1109f6e41e`.
- Legacy build fingerprint: `702394ffd774f6afd78aef84e73c9762c70bd76f67606913840b93d502dba744`.
- Existing `app.asar` SHA-256: `3ad4bce6b2c3fd7d32336d08b892ea0a36e47d740be82f792a354fff4d51a66e`.
- All **415 code/config source files** in that archive match the frozen source;
  package name/version/standard bootstrap match. The archive was not rebuilt.
- The prior A/B receipt declares the same legacy source fingerprint. Its file
  hash is recorded, but its actions were not rerun. The old full-test text and
  455-file package receipt do not themselves declare a source fingerprint;
  they remain imported maintenance evidence, not retroactively proven bindings.

Commands (replace local paths with the frozen snapshot/retained archive you hold):

```sh
node scripts/candidate-identity.cjs --source SOURCE_SNAPSHOT \
  --snapshot DIRTY_SOURCE_MANIFEST --asar APP_ASAR --output IDENTITY_JSON
npm test -- test/candidate-identity.test.cjs
codesign --verify --deep --strict 'PATH/Agent Arcade.app'
```

New results: `candidateMatches: true`, `sourceFiles: 415`; identity tests **3/3**
passed; strict static signature verification passed on this Mac. This checks
source/package identity, not app behavior, Gatekeeper, another machine or model
quality. The identity tool does not launch an App, decrypt credentials or rebuild.
It rejects a changed source/archive pairing and incomplete cloud-file reads.

## Evidence already recorded before this execution

| Imported maintenance claim | What it supports | What it does not support |
| --- | --- | --- |
| 5000 tests: 4283 passed, 717 platform skips, zero failures | The earlier isolated test run, with its retained text digest | A new run here, all skipped platforms, or independently bound source for that text |
| Strict signature and 455 packaged source-file byte comparisons | The earlier full-file package check (including non-code assets) | A new 455-file comparison here; current new comparison is 415 code/config files |
| Dedicated test-Keychain fake key/history/memory survived two ad-hoc package CDHashes | Bounded earlier A/B retention; declared source fingerprint matches today's frozen source | Real model output, prompt-free updates under all signing identities, or distribution certificate readiness |
| Owner-authorized real-profile observation: existing DeepSeek key readable, two chat rows retained, three main roles switched and original restored | Bounded previous real-profile retention/UI automation | A model call, new account/provider validity, human Keychain-dialog acceptance, first-time stranger success or seven-day return |

Private receipts, profile paths and transcripts are deliberately not public
links. [VALIDATION](VALIDATION.md) supplies the broader evidence boundaries.
No live profile, credentials, account or running App was opened by this execution.

## New focused checks after the static capture

The same frozen source passed **51/51** focused update-backup, identity,
credential-recovery/scope and App-persona checks in this execution. Its fixed
companion cases pass **19/19 required**, retaining one exploratory synonym gap;
see [COMPANION_CASES](COMPANION_CASES.md) and the
[new verification receipt](evidence/adoption-verification-20261115.json).
The preparation branch's separate full compatibility run does not integrate
that source or turn its private candidate into a public release.

## Before a new candidate or trial

1. Review and integrate the original repairs into a committed source identity.
   Their ongoing integration is owner work; do not package the old committed
   baseline while describing the later repair candidate.
2. Produce one identifiable candidate from that committed source, with archive/
   installer hashes and platform. Bind the exact fixture and validation output
   to it; do not silently reuse a different same-version local package.
3. Complete the concentrated real-key/model/native/human checks before inviting
   strangers. Publication and invitations remain explicit owner actions.

Prepared documentation and safety tools can be kept or reverted independently.
The owner has not authorized push, release, external messaging or new account
access in this execution.
