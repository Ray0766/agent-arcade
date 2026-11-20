# Agent Arcade · Mac QQ 群聊验证版

`0.4.0-preview.61.qa.3` 供 Apple Silicon Mac 复测两条群聊首用路径。搭档账号尚未与主人互加好友时，启动指引带你回到「测试连接」。群模型鉴权失败时，对应搭档的 QQ 对话页会出现「查看群聊诊断」。模型恢复后，群友新发一句即可重试。

## 在 Mac 上复测

准备 Node.js 24、npm 和 Git。在一个干净目录运行以下命令。依赖与 Electron 首次安装需要联网。

```sh
git clone --branch preview/mac-qq-qa.3 --single-branch https://github.com/Ray0766/agent-arcade.git
cd agent-arcade
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
node scripts/build-recovered-mac-qa.cjs node_modules/electron/dist
```

构建结束时，`QA_BUILD_OUTPUT` 指向 DMG 和 ZIP。打开 DMG，把「Agent Arcade QQ QA」拖到一个测试目录。进入该目录后运行：

```sh
"./Agent Arcade QQ QA.app/Contents/MacOS/Agent Arcade QQ QA" --arcade-qa-verify
```

窗口会用临时档案、回环 OneBot 桥接与模型替身走完好友复查、模型故障、帮助、恢复和正常旁听。终端的 `QA_RECEIPT` 给出本次结果路径。该版本每次启动都会新建档案，安装包使用本地临时签名。日常使用请参阅[主分支](https://github.com/Ray0766/agent-arcade)。

构建输入来自已核验的 preview.61 运行源码、恢复的 preview.30 锁文件和开发测试，以及这次的界面修复和 QA 入口。完整的 preview.61 历史测试树仍未找回。真实 QQ、真实模型与群友试用待验收。

[English](README.md)
