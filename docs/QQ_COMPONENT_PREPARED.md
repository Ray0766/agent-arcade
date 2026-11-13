# Prepared QQ component versions

`src/bot/qq-component-prepared.cjs` extracts a fixed, verified NapCat Shell or Windows Node ZIP
into a new private version directory. It does not execute code, select a
version, replace QQ, read credentials or modify installed account data.
The upstream component retains its own license. Preparation does not establish
commercial redistribution rights; the ZIP is not bundled in this repository
or its application package.

## Contract

`QQComponentPrepared({root, packages, component, timeoutMs, lockRoot, processHost})` receives trusted main-process
dependencies. Production uses the shared component store next to the runtime
lock root, not a business profile's home directory. `packages` is the existing
[`QQComponentPackages`](QQ_COMPONENT_PACKAGES.md) instance.

- `prepare({version, signal})` calls the package's offline `verify`, hashes the
  same opened ZIP descriptor before extraction and again before publishing the
  manifest, and checks source identity. It accepts no caller-supplied path,
  URL or hash. The current supported version is `4.18.42`.
- `listPrepared()` returns at most 32 metadata summaries and fixed `issues`.
  It does not hash code or ZIP contents. Listed items have `verified: false`;
  they are discovery records, not proof of readiness.
- `resolvePrepared(versionId, {signal})` rechecks the staged ZIP, bounded
  manifest and complete prepared file tree. It returns filesystem paths only
  to trusted main-process callers; renderer summaries contain IDs/counts/
  sizes/digests. Selection must bind the checked manifest digest.

Layout: `qq-component-versions/napcat-shell/<versionId>/{code/,prepared.json}`.
The ID is `napcat-shell-<version>-<first 16 ZIP SHA-256 characters>`.
The `qq_component_prepared_v1` manifest records the official source identity,
sorted relative directories and sorted `{path,size,sha256}` regular files.
The manifest is excluded from the code-file list and has its own digest.

## Limits and failure behavior

Pinned **yauzl 3.4.0** parses metadata and streams bytes. Application checks add
Windows path restrictions and entry CRC32/SHA-256 verification; yauzl's size
validation alone is not a payload CRC check.

Limits: 10,000 entries, 128 MiB/file, 512 MiB expanded total, 250:1 entry
expansion, 16 path segments, 240 characters/relative path, 8 MiB entry metadata
and 2 MiB/manifest. Reject traversal, absolute/backslash/NTFS-stream/device
names, case collisions, duplicates, file-directory conflicts, encrypted data,
links and unsupported entry types. Output paths must be normalized relative
POSIX names. Nonempty root files `napcat.mjs`, `NapCatWinBootMain.exe`,
`NapCatWinBootHook.dll`, `qqnt.json` and a regular file under `static/` are
required. Nothing from the archive is executed.

Existing version directories are never overwritten. Files use exclusive
creation, the manifest is written last, and cancellation is checked again
before reporting publication. Failure cleanup removes only tracked files whose
identities still match, then empty directories created by this attempt. It
never recursively deletes a tree or removes unknown replacements. Therefore
an interrupted/changed directory may remain for inspection and block automatic
reuse. This is not an OS atomic compare-and-swap against another process that
deliberately bypasses management locks.

## Explicit recovery after interruption

New writers now record their exact process/directory identity and declared archive
inventory before extraction, using the shared per-version OS gate. Only an
unpublished `extracting` record can be explicitly quarantined and retained.
Old unknown directories, any published manifest, referenced versions and
`publishing` records remain protected. Recovery deletes no files and does not
retry preparation or start QQ. The ordinary preparation result also preserves
publication success if final gate cleanup fails.

See [interrupted preparation recovery](QQ_PREPARATION_RECOVERY.md) for the existing
drawer entry, confirmation semantics, refusal boundaries and separately scoped
child-process/UI evidence. The evidence below is the original extraction
checkpoint, not a claim that it covered this later recovery feature.

## Evidence

On 2026-11-06, **29 automated cases** passed using original temporary ZIPs:
path/link/collision/size rejection, corrupt payloads, cancellation during
extraction and final manifest sync, partial storage failures, preservation of
foreign files, and bounded read-only metadata discovery. Local log:
`outputs/qq-component-prepared-tests-20261106.txt`.

The separately downloaded official `v4.18.42` ZIP was actually prepared and
resolved: **35,967,555 ZIP bytes**, **684 files / 114,884,405 expanded bytes**,
**96,639 manifest bytes**. Preparation took 7,376 ms; subsequent full resolve
took 2,068 ms on this machine. File hashes and manifest digest matched. Receipt:
`outputs/qq-component-official-prepare-20261106.json`. These are one-run timings,
not a performance benchmark or startup guarantee.

This accepts extraction and read-back only. Selection, account start, retained
login, rollback, newer-version compatibility and publisher Authenticode checks
are separate flows. No component was selected or executed by this test, and
installed account data was not modified.
