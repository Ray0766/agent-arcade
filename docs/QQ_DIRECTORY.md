# Read-only QQ directory

Implemented in source on **2026-11-06**. The account's friends and groups can be
viewed in the same application window, with [read-only group members](QQ_GROUP_MEMBERS.md).
Separate [friend-request decisions](QQ_FRIEND_REQUESTS.md) and
[fixed-owner remark editing](QQ_OWNER_REMARK.md) have their own boundaries.
The directory also links to [manual existing-friend management](QQ_CONTACT_ADMIN.md),
[group profiles](QQ_GROUP_PROFILE.md) and [group administration](QQ_GROUP_ADMIN.md).
Each management view independently reads and confirms its target; directory
access alone grants no write authority.
This directory does not authorize group chat or messages to other people.

## Use

Open **QQ accounts → the intended account → Friends and groups** while its
runtime is running. The drawer shows the exact QQ number and current companion
label. If the account has multiple configured bridges, select one explicitly
before reading its list. The backend separately verifies signed-in identity and
online status; an enabled button is not proof that those checks will succeed.

- Use **Friends / Groups** to switch lists. Friends show remark, nickname and
  QQ number; groups show name, group number and available member counts.
- Search by name, remark or number. Search and 50-entry pagination operate on
  the current in-memory result without making more QQ requests.
- **Refresh list** requests `no_cache` from the component, but does not promise
  complete real-time synchronization. The displayed timestamp is when this app
  read the result, not when QQ last synchronized every contact.
- Close the drawer or press Escape to clear it. Changing the selected companion,
  component folder, account runtime or bridge metadata also invalidates it.
  Hiding the application clears the displayed directory. It is not persisted in
  conversation memory, the application snapshot or browser storage.

Groups provide **View members**, **Group profile** and same-drawer return routes.
Friends provide **Manage friend**; the configured owner also retains **Edit remark**.
Contact actions are limited to the separate explicitly described features above.
Existing designated-owner private conversations and autonomous-action limits
remain unchanged.

## Data and request boundary

`qqRuntimeDirectory({accountId, kind, groupId?, serverName?, fresh?})` returns a bounded
`{kind, accountId, items, fetchedAt, source:'bridge-cache'}` directory. The main
process owns connection credentials and verifies the actual QQ identity before
and after reading. The console rejects a changed directory, endpoint or selected
bridge. Stop/configuration/restore/close cancel conflicting requests. The
renderer additionally rejects a response for another account/list and ignores
promises superseded by tab changes, closing or account changes.

Only member reads accept `groupId`; their response also carries the exact group
ID. Their additional membership checks and field projection are documented in
[the group-member guide](QQ_GROUP_MEMBERS.md).

Only normalized friend `id`, `nickname`, `remark` or group `id`, `name`, optional
`memberCount` and `maxMemberCount` fields are returned. No token, endpoint URL,
original error body or avatar download enters the drawer. Names are rendered as
text, never HTML. The reader bounds a response to 1 MiB and a list to 10,000
items, with a ten-second total deadline. An oversized/invalid result is an error,
not a silently truncated complete list.

The first implementation follows the official
[NapCat friend-list action](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/action/user/GetFriendList.ts),
[group-list action](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/action/group/GetGroupList.ts)
and [OneBot 11 action definitions](https://github.com/botuniverse/onebot-11/blob/master/api/public.md).
These contracts do not establish that upstream caches contain every current
friend or group, nor that a group with zero returned rows is an implementation
of group conversations.

## Verification

The isolated UI fixture passed **15 checks / 5 screenshots**. It exercises exact
account display, literal untrusted names, search/pagination without requests,
keyboard tabs, empty/error states, explicit bridge selection, mismatched account
rejection, late promises and account/folder/bridge/visibility invalidation.
Chinese wide and Chinese/English 430 CSS px screenshots were opened and
inspected. The existing broader UI fixture also passed **42 checks / 28
screenshots** after this addition. Local evidence:

- `outputs/qq-directory-20261106-final-reviewed-ui.json`;
- `outputs/qq-directory-regression-20261106-ui.json`.

These screenshots and IPC handlers are synthetic, with no real messages or
model calls. Reproduce with `node scripts/qq-directory-ui-smoke.cjs`; optionally
set `ARCADE_UI_PREFIX` to keep a separate output checkpoint.

The production reader was also called directly against the actual Whale account
on 2026-11-06. It returned **2 friends and 0 groups**, with matching account
identity and only the allowed friend fields. The receipt records counts and
timings, not contact names/numbers: `outputs/qq-directory-live-reader-20261106.json`.
The subsequent `single-window-directory-20261106` package also passed the actual
drawer flow: two friend entries, local search narrowed to one, an empty group
list displayed successfully, and close returned to the same application window.
Receipt: `outputs/qq-directory-live-ui-20261106.json`. No message, group action
or model call was performed. Large live lists remain untested. The later source refinement labels the bridge's self-entry as
“自己”; its isolated fixture passed **17 checks / 6 screenshots**
(`outputs/qq-directory-self-20261106-ui.json`). It was awaiting packaging at
that checkpoint and is retained in the later integrated packages.

In `single-window-plugin-admin-20261106`, the actual Ju directory displayed one
joined group and its reported 23 members. The member drawer loaded 23 entries;
searching for Ju returned the matching self identity with role `member`.
An independent read verified the account/online state, the group's presence
before and after the member request, 23 unique member identities and one self
entry. Private receipt: `outputs/qq-plugin-package-group-read-20261106.json`.
The drawer then closed normally. This is bounded cached-list/member/search
acceptance; no group write, chat, role grant or recipient expansion occurred.
