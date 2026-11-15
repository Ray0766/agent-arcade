# Update backups and retained App data

Agent Arcade keeps conversations, memory, settings, characters and encrypted
credentials in its data directory, normally `~/.agent-arcade`, separately from
the application bundle. `AGENT_ARCADE_HOME` selects a different data directory.
Replacing an App bundle does not replace this directory.

## Snapshot before opening a changed build

The startup integration must own the single-window guard and call
`ensureUpdateBackup` **before constructing any business store or running a
database migration**. The implementation is `src/core/update-backup.cjs`.

On an existing profile's first guarded startup, or when the code/lock fingerprint
changes, it copies the App data directory and any external companion data
directories registered in `companions.json`. Nested directories are copied
once. It does not inspect Claude/Codex login materials or export Keychain items.
Optional additional roots are an integration API, not an arbitrary renderer
file-copy command.

The explicitly configured data root may use a directory alias, including
macOS `/var` paths or an owner's symbolic link. It is resolved to its canonical
directory before choosing the backup location and build marker, so aliases of
the same profile do not create separate histories. Dangling links and links to
files are refused. This does not follow nested data links during copying or
relax the separate refusal of a linked backup destination.

The configured and registered roots cannot be a filesystem root, the current
user's home directory or its ancestors, or a directory inside that user's
`.claude`, `.codex` or `.aws`. An external registered profile must contain an
existing App marker such as `bot-config.json` or `bot-vault.json`. Encountering
a nested `.claude`, `.codex` or `.aws` directory also refuses the snapshot;
those files are never silently omitted while claiming a complete backup.

Backups live under `<data directory>/update-backups/<timestamp-build-id-random>/`.
Each root has a numbered directory; `manifest.json` maps them to their original
locations and records byte hashes. That manifest and backup contents are
private local data, not support attachments or material to commit. New
directories use mode `0700` and ordinary files use `0600` on POSIX. Inner
symbolic links are preserved as links; their outside targets are not copied.
The output directory itself must not be a symbolic link. The implementation
never deletes a completed backup automatically.

The snapshot includes SQLite main, WAL and SHM files. It compares the complete
source-tree inventory and SHA-256 hashes before and after copying. SQLite
`quick_check` runs only against the **copy**, including uncheckpointed WAL rows;
the source database is never opened or checkpointed by this module. A changing
source, unreadable registry, invalid SQLite copy or failed write blocks startup
migration. Only the current invocation's incomplete staging directory is removed
on failure; a completed backup is retained even if writing its build marker fails.

The default bounds are 50,000 filesystem entries, 1 GiB total file bytes, 512 MiB
per file and depth 32. A profile exceeding a bound needs an explicit maintenance
decision; the App must not continue by silently omitting data. A large task
worktree or cache in the data directory can reach those bounds.

The build identity hashes `package.json`, a lockfile when present and the
JavaScript/CSS/HTML/JSON source under `src`. It detects repairs made without a
package-version bump. Generated icons, binary media, absolute installation paths
and code-signature bytes are excluded. Repacking identical code does not create
another data snapshot; a changed signature still has its separate Keychain
permission behavior. A fresh empty profile records its build identity without
creating an empty backup. The same code identity does not create another copy
on every normal launch.

## Recovery limits

This backup mechanism does not automatically restore data or overwrite a newer
profile. To recover, quit every App process first, keep a copy of the current
profile, and restore the complete numbered root (including any WAL/SHM files)
to its mapped location. The manifest's `sourceMode` retains original permission
bits; restore executable bits deliberately where needed rather than making the
backup itself executable. For a database downgrade, restore the matching complete
profile snapshot; do not copy just one chat database into a newer profile.

Credentials remain OS-encrypted. Copying `bot-vault.json` does not back up the
macOS Keychain encryption key or make credentials portable to another machine.
App identity, Keychain access and encrypted-vault retry/recovery must be handled
separately. A successful file backup does not prove that a different signed
build can open the Keychain, and losing the system encryption key cannot be
fixed by a file copy alone.

## Verification

`npm test -- test/update-backup.test.cjs` covers an existing profile's first
snapshot, a same-version code change, no repeated snapshot on ordinary launch,
WAL-only chat rows and database version retention, external companion roots,
symlinks, private permissions, changed input, corrupt SQLite, bad registry,
bounds and failed state publication. The tests use real temporary files and
SQLite databases, without real API keys, models or accounts. Startup integration
and real build-to-build Keychain behavior require their own verification.
