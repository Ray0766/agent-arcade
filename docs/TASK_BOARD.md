# Task board

Open **Work → Tasks**. A draft does not start itself. Pick a Git repository,
write the task, then choose **Dispatch…** and review the confirmation.
The board requires Git and Claude Code 2.1.317 or newer with background-session
commands. An installed but older version is reported separately from a tool
whose availability could not be confirmed.

## Work and acceptance

Each task has a separate Git worktree outside the original checkout. When the
installed CLI lists `acceptEdits`, file edits in that worktree are pre-authorized;
commands still use Claude Code's own confirmation. Otherwise the board uses
ordinary confirmation. This is not a sandbox. The main-checkout comparison is
best effort and cannot identify who changed a file or prove isolation.

A reply ending means **Handed back, not verified**. Review **View changes** and
the hand-back, then choose **Accept…** only after checking the result yourself.
Stopping a session leaves it **Session stopped, not verified**.

## Rework

Choose **Rework…**, write what needs changing, then **Start rework**. The App
checks the exact old owned job and confirms it is stopped (or stops it and
checks again). A reply-ended `done` state alone is not enough. It starts a fresh background round in the same worktree with the
original brief and the owner's latest rework requirement. Existing files and
commits remain. The new round has a different launch/session identity; late
observations from the earlier session cannot mark the new round handed back.
A new round also means the old session's transient conversation context is not
resumed. The task brief, current files and rework requirement are its inputs.

An unknown old job or an unconfirmed stop blocks a new writer. A definite
launch rejection can be retried; an uncertain launch stays visible as unknown
and is not blindly repeated after restart. Rework does not accept the task.

## Finished history and cleanup

Today's finished tasks stay in their column. Expand **Finished history** below
the columns to review earlier tasks, their diffs and acceptance notes.
**Remove** requests confirmation; if the worktree contains uncommitted changes
or commits not merged into another local branch, removal is refused. Merge or
back up the work yourself, or explicitly confirm **Discard the worktree and its
changes** twice. Discarding cannot be undone.

The App never deletes a worktree automatically. Its board record is retained
while it names a worktree, even when the usual metadata retention limit is
reached. Worktree-free finished metadata is kept up to 200 entries / 30 days.
At 220 total entries, clean up old tasks before creating more drafts. The board
file is bounded at 2 MiB; failure to save is shown on the board.

## Verification and limits

`npm test -- test/task-board.test.cjs test/task-worktree.test.cjs` checks state
transitions, new-round rework, exact old-session binding, refused/uncertain
stops and launches, restart/no replay, retention, explicit cleanup, and real Git
worktree diffs/removal with paths containing spaces and shell metacharacters.

`node scripts/task-board-ui-smoke.cjs` opens real Electron with an isolated
profile and a real temporary Git worktree. Seeded task states are visibly
labelled synthetic. It checks Chinese/English, 430 px width, historical diffs,
dirty-removal refusal and explicit discard through production IPC. It does not
launch Claude or call a model. Local receipt: `outputs/task-board-ui.json`;
three screenshots accompany it. This script enters `src/main.cjs` directly to
avoid interfering with another desktop instance; bootstrap/single-instance is
covered separately.

Real Claude Code background dispatch, permission behavior, trust prompts and a
full owner-driven rework/acceptance flow remain unverified. The installed CLI
on the Mac used for this work was older than the required version. Automated
fixtures and successful Git cleanup do not accept those live flows.
