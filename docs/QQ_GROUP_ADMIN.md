# Explicit QQ group administration

Implementation checkpoint: 2026-11-06. Manual group and member management is
integrated into the existing single-window directory. Source, protocol, IPC and
renderer checks passed. No real member or group mutation has been performed for
this feature. The earlier Whale group-list read returned empty; the current
`single-window-plugin-admin-20261106` package read Ju's one joined group and
23 members, with self search 1/23 and observed role `member`.

The feature does not enable group conversations, group memory, automatic
moderation or model tools. The companion's configured private-owner chat scope
is unchanged. Account management and AI connection remain separate.

## Entrances

- **QQ accounts → Friends and groups → Groups → View members → Manage member**
  keeps one actual group and one listed member in view.
- **Groups → Group profile → Group management** handles group-wide actions.

Both replace the body of the same drawer and return to the previous list or
profile. List labels and cached roles are navigation hints, not permission
proof. Reading management details is explicit; entering a page does not submit
an action. All operations require a separate preview and one-time confirmation.

The scope includes member cards, individual mute/unmute, whole-group
mute/unmute, administrator assignment/removal, member removal, leaving a group
and dissolving an owned group. An unsupported or prohibited action must explain
its limitation instead of presenting an enabled button that cannot work.

Member removal also offers an unchecked option to refuse that member's later
join requests. The preview must show the choice separately. There is no verified
readback or undo action for this extra option, and the interface does not promise
a permanent ban. Observing a member's absence cannot verify this setting.

Cards preserve the exact entered text, including an empty string for clearing,
within the app's 60-code-point / 120-UTF-16-unit limit. Control and formatting
characters are rejected. Individual mute duration accepts integer seconds from
zero (unmute) through 2,592,000; this is a local 30-day bound, not a verified QQ
platform maximum. Common duration choices do not replace the custom duration.

Each preview is bound to the observed account, installation, connection, group,
member, role and original value. It expires after five minutes on a monotonic
clock. The final guard runs again after asynchronous identity and permission
checks. This narrows accidental cross-account and stale-confirmation errors;
it cannot make cached bridge observations into an atomic server-side check.

## Acknowledgement and observations

The fixed upstream handlers do not have identical success semantics:

| Operation | Pinned handler's matching successful response | What it cannot establish alone |
| --- | --- | --- |
| Member card | The bridge observed the requested card during its own bounded follow-up reads | Native result zero, fresh server data or another client's display |
| Member / whole-group mute | The handler checked native result zero before returning | Continued permission, exact duration across clock differences or recipient experience |
| Administrator / remove / leave / dissolve | The handler completed its awaited action and returned; it does not check a native success result | Actual role change, removal, leaving or destruction of the group |

An independent later read is displayed separately from acknowledgement. Cache
data can be returned despite a fresh-read request. An account's group list no
longer containing a group does not prove that the group was dissolved for
everyone. A disappeared member row is an observation, not irreversible removal
proof. Unknown results consume the ticket and are not automatically replayed;
closing the drawer does not undo or cancel a remote action already submitted.

## Fixed technical basis

The review uses NapCat **4.18.42**, commit
`9335843246e3b7a17944861f3ac8731a259732c2`, checked on 2026-11-06. Agent Arcade
implements its own management controller and UI over these actions; it does
not copy the upstream implementation into the project.

- [Member card](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupCard.ts)
  performs up to three follow-up card reads after its native call.
- [Member mute](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupBan.ts)
  and [whole-group mute](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupWholeBan.ts)
  explicitly check the native result.
- [Administrator](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupAdmin.ts),
  [removal](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupKick.ts)
  and [leave/dissolve](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupLeave.ts)
  return `null` after awaiting their respective bridge calls.
- [Member details](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupMemberInfo.ts)
  can fall back to cached membership; [group details](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupDetailInfo.ts)
  include raw and derived whole-group mute fields. Missing raw data must not be
  silently interpreted as unmuted.

## Remaining acceptance

The implementation passed 56 focused backend/session/actual-main checks with
production components and synthetic local WebSocket inputs. The broader suite
passed 2529 of 2530 tests, with one opt-in Windows process-tree check skipped and
zero failures; 378 JavaScript syntax files passed. Renderer checks covered 23
cases and nine inspected screenshots, including Chinese/English narrow-window
and scaling cases. Adjacent group-profile and member-directory fixtures passed
25 and 19 checks respectively. These counts overlap the full suite where
applicable and must not be added as independent coverage.

The earlier package `single-window-group-admin-final-20261106` matched 194 source
files, two notices, 11 metadata fields and three unpacked assets. Only a group
list description and a fixture explanation changed after the full check;
those two files passed syntax and text readback, without repeating the suite.
The earlier packaged directory was actually opened with Whale AI disconnected,
and its group-list read returned empty. That is an entrance/empty-state check,
not a successful group administration transaction. The final package was then
opened with the same stored configuration; Ju and Whale QQ/AI were restored,
and the corrected group-list explanation plus empty list were inspected.
Dragon had required login before the update and remains deferred, unstarted.

In `single-window-plugin-admin-20261106`, Ju's one joined group displayed
23/200 members; self search returned 1/23 with role `member`. Independent
read-only checks confirmed the 23-member count, the same account identity and
membership before/after. The private receipt is
`outputs/qq-plugin-package-group-read-20261106.json`. This is directory/cache
evidence, not a submitted administration action or an atomic permission proof.

Large-list pagination, switching scope during a pending read, each submitted
operation, role changes during confirmation and independent recipient
observations of mutations remain part of the later controlled group test.
Synthetic data, local WebSocket fixtures and build success cannot complete
those checks. No real group was moderated, left or dissolved in this check.

See [group-name management](QQ_GROUP_PROFILE.md), [group member reading](QQ_GROUP_MEMBERS.md)
and [the complete scope](ACTIVE_GOAL.md) for their separate evidence.
