'use strict';
const fs=require('node:fs'),path=require('node:path');
const { createIcon }=require('../src/core/icon.cjs');
const dir=path.join(__dirname,'..','src','assets');fs.mkdirSync(dir,{recursive:true});
const png=createIcon(16);fs.writeFileSync(path.join(dir,'app.png'),png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(dir,'app.ico'),Buffer.concat([ico,png]));
