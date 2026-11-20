# Agent Arcade · Mac QQ group QA

Version `0.4.0-preview.61.qa.3` exercises two first-use paths on Apple Silicon. When the companion and owner are missing from each other’s QQ friend lists, setup directs the owner back to Test connection. When model authentication fails, the affected companion’s conversation links directly to group diagnostics. After recovery, a new group message can receive a reply.

## Run on Apple Silicon

Install Node.js 24, npm and Git. Run the following in a clean directory. The first dependency and Electron downloads need a network connection.

```sh
git clone --branch preview/mac-qq-qa.3 --single-branch https://github.com/Ray0766/agent-arcade.git
cd agent-arcade
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node scripts/build-recovered-mac-qa.cjs node_modules/electron/dist
```

The build prints `QA_BUILD_OUTPUT` with the directory containing the DMG and ZIP. Open the DMG, copy Agent Arcade QQ QA into a test directory, and run this command from that directory:

```sh
"./Agent Arcade QQ QA.app/Contents/MacOS/Agent Arcade QQ QA" --arcade-qa-verify
```

The app uses a temporary profile, a loopback OneBot bridge and a model fixture. It exercises friendship checks, provider failure, local help, recovery and intentional silence. The terminal prints the result path after `QA_RECEIPT`. This ad-hoc signed QA app creates a fresh profile on each launch. See the [main branch](https://github.com/Ray0766/agent-arcade) for daily use.

Build inputs combine the verified preview.61 runtime with the recovered preview.30 dependency lock and development tests, the two UI fixes and the QA entry point. The complete historical preview.61 test tree remains unavailable. Live QQ, live model use and participant trials are pending.

[简体中文](README.zh-CN.md)
