# Build-chain maintenance — 2026-11-15

The Electron/Node/SQLite stack is retained. No measured benefit justifies a
replacement. This change addresses the reproduced build dependency advisory,
not a new companion feature or a claim of complete application security.

## Later integrated native build

The repairs and prepared lock are now integrated on `codex/integrated-macos-20261115`, with a fresh `0.4.0-preview.2` native arm64 DMG/ZIP built from a clean committed source. Full commands, artifact hashes, build-source identity and actual package checks are in [the integration report](MACOS_INTEGRATION_20261115.md). This closes the earlier preparation-only native-build gap for this Apple Silicon machine, not Intel/Windows/Linux or real-user acceptance. The earlier observations below retain their original scope.

## Recheck and decision

- `npm audit --json` on the original lock reported **six moderate dependency
  entries**, all following [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  (read 2026-11-15). This is one pattern-amplification advisory, not six independent
  runtime vulnerabilities. Its affected range is `>=7.0.0 <11.0.1`; the published
  fix is `11.0.1`, including the optimization-level-2 issue.
- The affected installed consumers were `app-builder-lib@26.18.1` using
  `minimatch@10.2.6`, and `@electron/universal@2.0.3` using `9.0.9`. These are
  development/build paths. No direct minimatch import was found in `src/` or
  `deploy/`. This does not prove that every indirect use is unreachable.
- The npm suggested automatic fix was an electron-builder major downgrade;
  it was not accepted. The registry's `latest` dist-tag was also behind the
  pinned 26.18.1 during this check, so "upgrade to latest" was not a reliable fix.
- The selected override applies **only to the advisory's affected version range**:
  `"minimatch@>=7.0.0 <11.0.1": "11.0.1"`. It changes both affected consumers to
  the fixed matcher without replacing legacy 3.x/5.x function APIs used by other
  packages. Direct dependency versions, including Electron and builder, stay
  pinned. Unrelated brace-expansion lock entries retain their previous versions.
- This is a cross-major transitive override. Keep its consumer compatibility
  tests until upstream consumers request a fixed version themselves, then
  remove it deliberately. Do not generalize it into "override every minimatch".

The 11.0.1 npm metadata requires `18 || 20 || >=22`, compatible with the declared
22.13 minimum and the supported full-test Node 24.x environment. Metadata and
package integrity were fetched from the official npm registry. No installation
script, App, real account or model was run for the dependency checks.

## New evidence

A separate temporary directory, with no shared node_modules, installed the final
lock using `npm ci --ignore-scripts --no-audit --no-fund`. It resolved 410 packages.
The final lock is checked in; a fresh install must use it, not a stale shared
node_modules tree. npm's first parent-scoped override attempt retained the old
nested 9.x node, so a changed package.json alone was explicitly not accepted as
proof of remediation.

| Check | Result | Boundary |
| --- | --- | --- |
| Full `npm audit --json` | 0 reported advisories after the clean install | Advisory database result at lookup time, not a security audit |
| Production `npm audit --omit=dev --json` | 0 reported advisories | Does not establish runtime safety or malicious-input resistance |
| `npm test -- test/build-matchers.test.cjs` | 3/3 passed | Actual builder FileMatcher includes/excludes and asar-unpack patterns; both affected consumer resolutions and universal matching API; 3.x/5.x isolation |
| Native packaging / signing / Windows / Intel | Not run in this execution | No rebuild of the separate uncommitted repair candidate; future integration must run relevant CI/native checks |

The file matcher cases preserve source/license inclusion, proprietary SDK
exclusion, private work/output exclusion and the existing native/voice/persona
unpack boundaries. These are consumer-level contracts, not a copied matcher
implementation. They run in the normal test suite.

Reproduce after installing this branch's final lock:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test -- test/build-matchers.test.cjs
npm audit --json
npm audit --omit=dev --json
npm run check:release
```

The sanitized [dependency receipt](evidence/build-chain-20261115.json) records
lock hashes, advisory counts, matcher versions and validation scope. Raw npm
metadata/audit output remain private temporary evidence; no credentials or
private profile were collected. See [candidate identities](CANDIDATE_STATUS.md)
for why this preparation commit is not a replacement Mac binary.
