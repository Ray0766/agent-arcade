# Read-only QQ group members

Implemented in source on 2026-11-06. Open **QQ accounts → Friends and groups →
Groups → View members**. The same drawer shows the account, selected group,
member QQ number, nickname, group card and owner/admin/member role. Search and
50-row pages work locally. **Back to groups** retains the previous group search
and page without making another request.

This is a directory, not group chatting or permission to message its members.
It has no invite, join, mute, remove or member-edit actions. The existing
designated-owner private chat boundary is unchanged.

## Data and lifecycle

The existing private `qqRuntimeDirectory` call accepts `kind:'members'` with an
exact string `groupId`; friends/groups reject a supplied group ID. The main
process chooses the credentials and endpoint. One bounded socket performs:

1. Signed-in account and online-state checks.
2. A group-list read proving the selected ID is present in the observed cache.
3. The fixed `get_group_member_list` action for that group.
4. Another group-list read, then account and online-state checks.

Members must all belong to the selected group, have unique valid IDs and a
known role. Only `id`, `nickname`, `card` and `role` reach the renderer; age,
location, activity times and other returned fields are discarded. Names are
plain text. There is a ten-second total deadline, 10,000-row limit, 1 MiB frame
limit, 4 MiB total-input limit and 256-frame limit. Invalid or oversized results
fail as a whole instead of silently appearing complete.

Account/runtime/installation/bridge changes invalidate pending results and
displayed rows. Returning, changing tabs, hiding or closing clears the member
view. A late result cannot replace another group's view. The display is not
saved to model memory, browser storage, logs or the public application snapshot.
Closing the drawer invalidates its result; it does not promise cancellation of
an upstream cache refresh already in progress.

## Cache limits and sources

Checked on 2026-11-06 against the [OneBot 11 contract](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#get_group_member_list-获取群成员列表)
and the pinned [NapCat member-list action](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupMemberList.ts).
The latter can return its existing map while a requested refresh continues.
Accordingly, **Refresh** requests `no_cache` but does not prove a current,
complete Tencent roster. The two group-list checks detect changes visible to
the bridge, not an atomic remote membership transaction. An empty response is
an empty observed cache, not proof that a live group has no members.

## Verification boundary

The formal reader/coordinator and adjacent regressions passed **208/208**;
`outputs/qq-group-members-formal-regression-20261106-tests.txt` records the run.
These use synthetic loopback transport, including mismatched identities,
membership changes, malformed rows, limits, cancellation and stale results.
They are not real-account acceptance.

The formal-source UI fixture passed **19 checks / nine inspected screenshots**,
including Chinese/English 430px windows, 150% zoom, retained friend-request and
owner-remark entrances, and installation-switch invalidation. Reproduce with
`node scripts/qq-group-members-ui-smoke.cjs`; its receipt is
`outputs/qq-group-members-20261106-ui.json`. It runs a hidden fixture with
production JS/CSS and synthetic transport. The frozen
`single-window-group-members-20261106` package matches 146 source files; full
regression passed 1721 of 1722 checks with one skip. It has not been launched.
The later `single-window-plugin-admin-20261106` package passed one nonempty
actual Ju group/member flow: one joined group, 23 member entries, and a local
self search matching the actual account and `member` role. The drawer closed
back to account management. A separate bounded read confirmed the identity,
online state, membership before/after, unique count and self role;
`outputs/qq-plugin-package-group-read-20261106.json` is private. This does not
verify every member's remote role, a large list, future synchronization or a
real account switch during a pending read. Group messages remain disabled.
