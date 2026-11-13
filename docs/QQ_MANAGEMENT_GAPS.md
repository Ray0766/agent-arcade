# Remaining QQ management contracts

Checked on 2026-11-06. Cross-version component changes and explicit outgoing
friend applications remain in the agreed single-window scope. The findings
below explain specific missing contracts; they do not remove either capability
from the delivery inventory. No account, configuration, installation selection
or running process was changed for those two contract investigations. The
separate self-profile implementation and real acceptance below do include
explicit user-confirmed writes.

## Nickname and avatar progress

Nickname and avatar management are no longer implementation gaps. The
`single-window-profile-editors-20261106` package passed a bounded flow with
Whale's AI disconnected: nickname draft/close without submission, a test
nickname and explicit restoration, then an original v1 avatar upload and
explicit restoration of v2. Each nickname submission had native zero,
matching bridge-cache observation and independent hash verification; the
ordinary owner's QQ profile card displayed both nicknames and both avatars.
The original nickname, signature and avatar were observed at the end. All four
writes came from separate explicit confirmations; none was an automatic retry
or restoration.

The remaining contract limits are concrete. Nickname saving also writes the
profile fields read internally by the bridge. Unchanged signature and observed
sex/birthday hashes in this check do not establish the exact private native sex
value or atomic preservation. Avatar appearance was checked in an ordinary QQ
client; the application still has no verified current-avatar readback API.
The later empty-editor validation-display fix was built and subsequently opened;
these real writes belong to the earlier package. See [self-profile evidence](QQ_SELF_PROFILE.md)
and [avatar handling](QQ_AVATAR.md). Cross-version changes, outgoing friend
applications, pending platform/group tests and the remaining nine-item gates
keep their existing status.

## Cross-version component upgrade and rollback

The existing implementation supports fixed official preparation and bounded
same-version operations. It does not implement cross-version upgrades or QQ
client/data migrations. The reviewed official release metadata identified
4.18.42 as latest at the check time; 4.18.41 was examined as the preceding
release, not selected as an upgrade or rollback target.

| Reviewed release | Fixed source commit |
| --- | --- |
| [4.18.41](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.41) | `859eb530c5801577633c2c3ae871d23586edf281` |
| [4.18.42](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42) | `9335843246e3b7a17944861f3ac8731a259732c2` |

There is a concrete isolation difference: the examined 4.18.41
[Shell startup](https://github.com/NapNeko/NapCatQQ/blob/859eb530c5801577633c2c3ae871d23586edf281/packages/napcat-shell/base.ts#L54)
and [core data-path handling](https://github.com/NapNeko/NapCatQQ/blob/859eb530c5801577633c2c3ae871d23586edf281/packages/napcat-core/index.ts#L231)
do not honor the explicit `NAPCAT_QQ_DATA_DIR` override used by our managed
installations. That support was introduced by
[commit 093b3bf](https://github.com/NapNeko/NapCatQQ/commit/093b3bf4aaab03b5ee2837e6010d13350d780b0b)
and is present in the fixed 4.18.42
[data-path implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-shell/data-path.ts#L6).
The older `NAPCAT_WORKDIR` setting selects NapCat working directories; it does
not replace the QQ native data-directory contract.

Consequently, inserting 4.18.41 into the existing managed Shell/Node layout
would not preserve our explicit data-isolation guarantee. Possible access to
default QQ data is a source-based risk inference, not an observed downgrade
experiment. The current cross-version guard remains in place.

Matching QQ version-table entries or build recipes do not establish migration
safety. Both reviewed Node recipes name Node 22.11.0 and QQ 9.9.31.49738, but this
does not prove identical native archive contents or that older code can read
data written by newer code. See the fixed
[release workflow](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/.github/workflows/release-publish.yml)
and [Node entry](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-develop/index.js).
No configuration/data downgrade contract was established by the examined release
notes and source. Code rollback must not be described as data rollback.

The next usable increment requires a separately reviewed target archive,
complete QQ/native identity, verified data paths, a configuration/data
compatibility policy, and an isolated lifecycle test before reusing existing
account data. Preserve the installation lock, stopped-process proof, digest-bound
preview and original selection history. A new empty parallel environment can
be tested separately, but is not an in-place upgrade preserving login. Failure
to show a QR code or sign in does not prove that an attempted start wrote no data.

An offline candidate classifier passed 11 synthetic cases while keeping
`canActivate:false` and `canRollback:false` in every result. It is research
evidence only, not a production selector or permission to use another release.
No cross-version QQ execution was performed.

## Explicit outgoing friend applications

The fixed 4.18.42 [action table](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/router.ts)
and [handler registration](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/index.ts#L200-L438),
cross-checked against the verified official Node bundle, provide no verified
built-in outgoing friend-application action. The existing
[`set_friend_add_request`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/SetFriendAddRequest.ts)
accepts a flag from a received request and explicitly approves or rejects it.
It cannot initiate an application by QQ number.

Native declarations are insufficient to fill this gap:
[`addBuddy`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/services/NodeIKernelAddBuddyService.ts)
has opaque parameters and result, while
[`reqToAddFriends`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/services/NodeIKernelBuddyService.ts#L64)
is only a declaration without a verified built-in caller. The necessary QQ/UID
mapping, request tag, source enum, verification/challenge fields, response and
withdrawal behavior are not established. An incoming `sourceId` or validation
message is not an outgoing parameter schema.

The [event adapter](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/index.ts#L435-L463)
skips requests marked as self-initiated. A
[`friend_add` notice](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/event/notice/OB11FriendAddNoticeEvent.ts)
contains no outgoing operation ID. Neither provides a complete correlated
submission/acceptance/refusal lifecycle. No verified idempotency or withdrawal
action was found in this fixed surface.

The current directory can observe an existing friend; it cannot supply a new
application contract. Validating a manually entered QQ number checks only its
representation. An additional profile lookup would not establish permission to
apply or resolve the missing write action. Do not invent an action name, turn an
incoming flag into a target, or expose arbitrary packets/native calls as a
substitute.

Before implementation, obtain a fixed callable contract with those fields and
response semantics. Then bind an explicit single-target preview and one-use
confirmation to the actual account, installation and connection generation.
Cancellation before invocation can mean not submitted; after a possible write,
an uncertain result must not be replayed automatically. Closing a panel cannot
promise withdrawal. Bridge acknowledgement, independently observed friendship,
and recipient acceptance must remain separate facts.

No outgoing application was sent for this research. Incoming request management
has its [own implementation and evidence](QQ_FRIEND_REQUESTS.md); it does not
complete this missing capability. Any future manual application must preserve
the current owner-only chat/memory boundary and must not enable autonomous
contacts or group activity. See the [full inventory](QQ_INTEGRATION.md).
