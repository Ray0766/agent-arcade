# Verified QQ component packages

The QQ manager now has a **Component versions** entry in source. It connects
original modules for verified downloads (`qq-component-package.cjs`), private
extraction (`qq-component-prepared.cjs`), explicit selection and rollback
(`qq-component-selection.cjs`), and main-process coordination
(`qq-components.cjs`). The package downloader itself never extracts or executes
code. See [QQ integration](QQ_INTEGRATION.md) for the wider management scope.

The current selection changes only the NapCat code directory for the next
explicit start, at the same pinned version. It preserves the existing QQ
executable, account configuration and login data. Activation and rollback require
all affected runtimes and the external manager to be stopped. Source integration
and archive preparation are not evidence that the new selection has run QQ.

Compared with downloading a ZIP manually, the benefit is a repeatable record of
the exact selected release, official asset identity, expected bytes and verified
SHA-256. This is not publisher-signature verification, a QQ compatibility check,
an antivirus verdict or evidence that installation succeeded.

## Fixed source and release

The current catalogue accepts exactly one asset from `NapNeko/NapCatQQ`:

| Field | Pinned value |
| --- | --- |
| Release | `v4.18.42`, release ID `428738017` |
| Published | `2026-10-30T07:05:50Z` |
| Asset | `NapCat.Shell.zip`, asset ID `691263446` |
| Size | `35,967,555` bytes |
| SHA-256 | `02e5ff0f79916c1e04c81c1b4590056406fb4293f1f1300c955e71fd08b2829d` |

The [official release](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42)
and its [GitHub API metadata](https://api.github.com/repos/NapNeko/NapCatQQ/releases/tags/v4.18.42)
were checked on 2026-11-06 (Sydney). The production `inspect()` path also matched
these values in a real metadata-only request. No software asset was downloaded
or executed in that check. Framework, Windows Node and OneKey ZIPs are separate
assets and are not accepted by this module. `latest`, arbitrary tags, repositories,
asset names, download URLs and caller-supplied hashes are not supported.

GitHub's [release asset API](https://docs.github.com/en/rest/releases/assets)
exposes a digest and may redirect binary requests. Preparation requires an API
`sha256:` digest matching the built-in pin; missing or changed metadata stops
before asset download. Transfer uses HTTPS only, the fixed initial GitHub URL,
and at most three redirects to the explicit GitHub release-asset hosts. There
is no authentication token, cookie jar, proxy credential lookup or retry loop.
Signed redirect URLs are not saved in receipts or included in errors.

## Main-process API

```js
const {QQComponentPackages} = require('./bot/qq-component-package.cjs');
const packages = new QQComponentPackages({root: privateApplicationDataRoot});

// Network: bounded official metadata only; no directory creation.
const release = await packages.inspect({version: '4.18.42', signal});

// Network and disk: recheck metadata, stream and verify the fixed ZIP.
const prepared = await packages.stage({version: '4.18.42', signal});

// Local, read-only: require the receipt and rehash the fixed staged ZIP.
const checked = await packages.verify({version: '4.18.42', signal});
```

`stage()` returns `state: 'verified-staged'`, `component`, `version`, the fixed
local `file`, `size`, `sha256`, `assetId`, `reused`, `source`, `checkedAt`, plus
`installed: false` and `executed: false`. Its source is `github-release-api`.
`verify()` reports `source: 'local-stage-recheck'` and retains the upstream
provenance separately; it performs no network request or write. Verification is
a check at that time, not a permanent permission to trust the path. An extractor
must retain/check the opened archive's identity and verify the bytes it consumes.
Renderer callers must not provide filesystem paths or expected digests.

The constructor accepts a total operation deadline (default 120 seconds, maximum
10 minutes). Metadata and local recheck are capped at 30 seconds. `AbortSignal`
cancels the owned request and partial transfer. A transport injection exists for
tests; production uses the fixed HTTPS transport. It cannot change the catalogue.

## Private staging and failure behavior

Files are kept below:

```text
<application root>/qq-component-packages/napcat-shell/4.18.42/
  NapCat.Shell.zip
  verified.json
```

Metadata is limited to 256 KiB, verification receipts to 4 KiB, and streamed ZIP
bytes to the pinned size. An oversized, short, malformed, linked or mismatched
artifact is rejected. Path components and regular-file identities are checked;
symbolic links, junctions, hardlinked files and network paths are not accepted.

Each transfer uses its own exclusive `.part` file. Only matching size and hash
can proceed. `COPYFILE_EXCL` preserves existing files and creates no filesystem
link; the final ZIP is rehashed before an exclusive receipt is written. A valid
existing package can be reused after rechecking it. Conflicting files or receipts
are never overwritten. Cancellation/failure removes only the operation's own
identified partial file; unknown replacements and the old installation remain.

Promotion is **not a multi-file crash-atomic installation transaction**. A crash
or disk failure may leave an incomplete ZIP, receipt, or abandoned partial file.
Such a candidate is not accepted as verified: the next attempt fails closed or
requires a complete matching hash and receipt. Unknown leftovers are retained
for inspection instead of being silently repaired or deleted. No component is
selected or launched as a side effect, and active QQ data is outside this module.

## Product coordination

The renderer can request only `status`, `inspect`, `prepare`, `preview`,
`activate`, `rollback` or `cancel`. It cannot supply a path, URL, token or trusted
archive hash. A selection uses the digest from its explicit preview, so a changed
selection cannot silently replace the one the user reviewed. Rollback has its own
preview of the exact previous target.

Status discovery reads bounded preparation/selection metadata. Regular snapshot
publication uses memory only; `verified: false` on a listed preparation means the
files will be fully checked at preview/start, not that the archive failed. Repeating
preparation resolves and fully verifies an existing matching version instead of
overwriting it or accepting its directory name as proof.

Only one coordinator operation can run at a time. Switching also holds the QQ
manager's global busy marker, preventing another account from starting during
the change. Directory/manager replacement cancels pending work; cancellation
keeps the operation owned until cleanup settles. Shutdown waits for it. A change
already committed remains reported as `committed: true` even if subsequent status
refresh or read-back fails; the UI can then report the specific refresh issue.
The coordinator returns only bounded summaries and fixed error codes, never
archive paths, full file manifests or raw upstream errors.

## Evidence and remaining work

- The real production metadata-only receipt is
  `outputs/qq-component-official-metadata-20261106.json` (private work evidence).
- The later real official download matched all **35,967,555 bytes** and the pinned
  SHA-256: `outputs/qq-component-official-stage-20261106.json`, `reused: false`.
  It neither installed nor executed the component.
- Real extraction and read-back checked **684 files / 114,884,405 bytes** in the
  new private version directory. Receipt:
  `outputs/qq-component-official-prepare-20261106.json`. The version ID is
  `napcat-shell-4.18.42-02e5ff0f79916c1e`; the manifest SHA-256 is
  `9e89411ea5fcf73c9d0bd2fc33cb9f58013974d4f646be1c956537556336b094`.
  Preparation alone did not select or run it.
- `test/qq-component-package.test.cjs` uses real loopback HTTP streams, SHA-256
  and temporary files. For successful transfers, a VM test copy replaces only
  the catalogue's size/hash with an original synthetic payload; production has
  no pin override. Separate tests retain and check the real production pins.
- Tests cover metadata/asset mismatch, missing digest, oversize and corruption,
  redirect restrictions, cancellation/timeout, conflicts, links, a concurrent
  file appearing at promotion, disk failure, reuse and read-only rechecking.
- Coordinator tests cover stale context, late results, duplicate cancellation,
  shutdown cleanup, global account-start exclusion, safe summaries, repeat
  preparation and post-commit failures. The five-module regression passed
  **121 / 121** in **3,443.3948 ms**; receipt:
  `outputs/qq-components-integrated-tests-20261106.txt`. These synthetic boundary
  tests do not log in to or start QQ.
- Executable-signature inspection, installed-pair compatibility, actual
  activation, restart and rollback remain separate acceptance steps. None is
  implied by the archive checks or synthetic tests.

The module was developed after the `single-window-directory-20261106` package
was built and is not included in that package.
