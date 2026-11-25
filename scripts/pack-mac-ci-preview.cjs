'use strict';
// The hosted runner has no personal signing identity or installed credential
// broker. Build a fixed ad-hoc preview with the normal runtime protections.
// Packaged macOS apps without broker metadata disable credential storage.
const {execFileSync}=require('node:child_process');
const {macRuntimeArguments}=require('./mac-credential-build.cjs');
const args=['--mac','--dir','--publish','never','--config.mac.identity=-',...macRuntimeArguments()];
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),...args],{stdio:'inherit'});
