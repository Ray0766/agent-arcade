'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
let count=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(cjs|js)$/.test(p)){const result=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(result.status){process.stderr.write(result.stderr);process.exit(1);}count++;}}}
for(const dir of ['src','scripts','test'])walk(dir);
console.log(`Syntax valid: ${count} JavaScript files`);
