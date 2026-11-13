# Manual QQ friend management

The source adds **QQ accounts → Friends and groups → Friends → Manage friend**.
It opens a drawer in the existing application window. Select a listed friend,
read their current details, then preview a remark change or a removal request.
The earlier fixed-owner **Edit remark** entry and its separately confirmed
restoration remain available.

This is explicit account management. It does not allow the AI to contact other
friends, process group chat or change the configured owner. No model is used to
choose a target, approve a request or interpret a management response.

## One account, one observed friend

The directory supplies a candidate, not authority. The main process requires a
selected registered companion, its exact saved QQ binding and a matching,
verified online runtime. A separate request-only connection checks the actual
account and online state and reads a bounded friend list. The selected friend
must occur exactly once; the account itself is not a valid target.

An AI connection is not required and its socket is never borrowed. The
configured owner ID is preserved when managing a different friend. The drawer
contains only the selected friend's nickname, projected remark, account IDs
and relevant observations; other private friend-list fields are not retained
in global snapshots or diagnostics.

Each preview binds the account, friend, observed values, operation and exact
additional choices. Confirmation consumes that preview once. Its five-minute
lifetime is checked using a monotonic clock, including immediately before the
write after asynchronous checks. Closing, changing accounts or replacing the
runtime retires the private management session. Closing cannot undo a request
already sent. Unknown results are not replayed.

## Remarks

The editor preserves spaces and allows an empty string to request clearing a
remark. Its application limit is 60 Unicode code points and 120 UTF-16 units;
control characters, formatting controls and isolated surrogates are rejected.
An unsupported existing remark stays read-only instead of being silently
truncated. Removal can still be reviewed for that existing friend.

The observed remark is the bridge's public projection, which can fall back to
the nickname when the native remark is null or absent. It is not a claim to
have read an unmodified native value. A fresh preflight checks the observed
baseline, but this is not an atomic remote compare-and-set.

For `set_friend_remark`, a matching successful envelope with null or omitted
data is an acknowledged bridge action. The later remark observation is shown
separately. An acknowledgement does not prove that another QQ client has
already synchronized the new remark.

## Removing a friend

Removal is under a separate collapsed section. The preview shows the exact
account and friend, plus two independent choices, both initially off:

- Request adding the contact to the blacklist.
- Request deletion on both sides.

These are requests, not verified effects. The application has no verified
readback or undo for either additional effect. It does not promise permanent
blocking, removal from the other person's interface, deletion of old messages
or a change in Qzone visibility.

The pinned bridge forwards an undocumented native deletion result. Therefore
this implementation does **not** turn a successful outer envelope into a
confirmed deletion. It shows whether a matching bridge response arrived and,
separately, whether a later cached friend-list reading still contains the
contact. Absence from that list cannot upgrade an unknown result to success.
Only the two exact known refusal shapes are classified as a bridge refusal;
raw native contents and error text are not exposed. Because the normal handler
also forwards an undocumented native value, matching a refusal shape cannot
prove which internal branch ran or that native deletion was never invoked.

The configured owner can also be selected explicitly. Removing that QQ
friendship does **not** revoke the local owner identity or task permissions,
disconnect the AI, or clear memories and configuration. To stop processing
that person's messages, explicitly disconnect the AI or change the binding.
Friendship and the application's authority configuration are separate.

## Sources and verification boundary

The contract was checked against NapCat **4.18.42**, pinned commit
`9335843246e3b7a17944861f3ac8731a259732c2`, on 2026-11-06:

- [Remark handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/SetFriendRemark.ts)
  and [native buddy service declarations](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/services/NodeIKernelBuddyService.ts).
- [Removal handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/go-cqhttp/GoCQHTTPDeleteFriend.ts)
  and [friend API delegation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/apis/friend.ts).
- [Friend-list projection](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/helper/data.ts)
  and [action envelope](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/OneBotAction.ts).

The integrated source passed **388 JavaScript syntax checks** and **2576 total
tests / 2575 passed / one opt-in skip / zero failures**. The skip is the existing
Windows process-tree exercise, not a contact test. The focused contact scope
has 43 controller/session/actual-main cases, included in that total. The
production renderer over the local protocol fixture passed **22 checks**;
nine screenshots were inspected, including Chinese/English narrow and enlarged
layouts. The prior owner and group drawers each passed 23 adjacent UI checks.
The final refusal wording correction reran only the affected new UI suite.

The actual `single-window-contact-admin-20261106` package then opened the
existing Whale account with AI disconnected. The new management drawer read
the configured owner's empty remark, previewed an unsaved remark and returned
to editing. A separate removal preview showed the exact identities, both
additional choices off and the owner-authority explanation. Returning to the
directory submitted neither operation. Independent before/after observations
matched remark, nickname and friend-identity hashes; the app owned zero
established bridge connections after returning. Original configuration hashes
also matched. This proves the bounded read/draft/close flow for that account,
not a new live write or deletion. Private observations are recorded in
`outputs/qq-contact-admin-packaged-ui-20261106.json` and
`outputs/qq-contact-admin-runtime-20261106.json`.

No real friend has been removed by this addition. Real non-owner remark
changes, deletion and its optional effects remain unaccepted; protocol fixtures
or screenshots cannot replace those account-level checks. The full outstanding scope remains in
[the active goal](ACTIVE_GOAL.md) and [the consolidated test stage](COMPANION_TEST_STAGE.md).
