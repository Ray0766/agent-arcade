'use strict';
// Waits for a condition one event-loop turn at a time. An open-ended
// `while(!x) await setImmediate` never ends when the step that should set `x`
// did not happen: the test times out, the loop keeps the file's process alive
// and the whole run hangs. This one fails with the name of what it waited for.
async function until(condition, {timeoutMs = 10000, what = condition.toString()} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await new Promise(resolve => setImmediate(resolve));
  }
}
module.exports = {until};
