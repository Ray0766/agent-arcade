# Start and connect a saved QQ companion

Select a configured QQ companion and choose **Start and connect / 启动并连接**.
Agent Arcade starts that companion's managed QQ runtime if needed, checks the
actual signed-in QQ account, then connects its saved AI configuration. It handles
only the currently selected companion. A running process or saved account number
alone is not enough to report a connection.

An API key already saved and readable in the app **does not need to be entered
again**. The key input stays blank intentionally. If credentials are locked,
missing or being cleared, resolve the displayed credential issue first; this
action does not replace or migrate them.

## Use it

1. Select the intended companion. Its QQ connection, expected QQ account and
   distinct owner must already be configured. Keep its existing AI mode.
2. Choose **Start and connect**. If that QQ runtime is already owned and running,
   the app checks it without starting another copy. Other managers' or uncertain
   processes require the existing QQ management flow.
3. Wait for the result. The app checks login for up to **60 seconds**. This bounds
   the login wait, not every underlying process or connection operation. Only a
   fresh matching QQ identity and verified AI connection produce a connected
   result; API credit or a successful model reply is not tested.
4. If the result says sign-in is required, open **QQ sign-in & runtime**, verify
   the intended account and complete the existing QR flow yourself. Then choose
   **Start and connect** again. An offline or unverified state alone does not mean
   a new scan is necessary.

**Cancel** prevents steps that have not started and waits for the current step
to settle. It does **not** stop a QQ runtime that has already started. Use the
separate **Stop QQ** control when that is your intention. Changing companion,
hiding/minimizing the window or changing relevant connection settings also
invalidates pending steps. An uncertain startup or connection is not retried
automatically; inspect the reported state before making another explicit attempt.

The preliminary, read-only eligibility check has a separate recovery path. If
it returns a temporary `changed` result, a later visible/focus notification can
trigger one recheck for that selected configuration, including when the first
response was still pending. It never replays Start or a completed/failed launch.
Repeated notifications do not create a polling loop. The message says the
connection could not be checked, without asserting that settings were modified.
The main process still verifies the current window, binding and configuration.
The isolated test uses real Electron hidden/shown windows and the production
capture guard, with a controlled renderer focus notification; it does not prove
OS focus delivery or explain the two earlier live startup failures.

In the operated `single-window-appearance-ready-20261108` build, the initially
selected Whale companion showed an enabled Start button without a manual
recheck. Whale and Ju each reconnected through one explicit Start action using
their original keys and QQ sessions, with independent account/online checks.
This run used a normal visible launch; it did not record whether the initial
check succeeded directly or used the retry, so it does not establish the cause
of the earlier hidden-launch observations.

## Modes and saved settings

API modes use their existing saved provider key. Local Claude program mode and
Codex use their original program-login paths; having a saved configuration does
not verify those logins or their remaining allowance. Legacy Channels keeps its
separate manual startup flow.

Supported **companion mode** does not require a project folder. **Task mode** still
requires its configured workspace. This shortcut does not change mode, owner,
character, permissions or credentials. It sends no test message; after connection,
ordinary message handling and previously enabled companion activities may run.

There is no automatic launch on app/Windows startup, batch startup, or restoration
of an assumed previous online state. Existing connection-loss handling and
no-replay rules are unchanged. See [QQ management](QQ_INTEGRATION.md) and
[companion mode](COMPANION.md).

## Verification

On 2026-11-07, the packaged app opened the original local profile and restored
Ju/Claude API and Whale/DeepSeek API through one explicit action per companion.
Neither needed a new QR scan or API key. Separate read-only checks confirmed the
actual QQ identities, online state, unchanged configuration and one runtime per
account. The saved-settings summary and verified-connection result were inspected
in the real window. Dragon was not started; its sign-in remains deferred.

Cancellation, stale context and failure cases have bounded runtime/coordinator
and isolated production-service evidence. They are not all real-account tests.
This check did not send a model prompt or verify provider balance, API validity
or long-term QQ session persistence. See [the active goal](ACTIVE_GOAL.md).
