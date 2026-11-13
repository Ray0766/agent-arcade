'use strict';
// Ordinary repository modules only: no alternate source tree or work-directory loader.
const path=require('node:path'),root=path.resolve(__dirname,'../..');
function load(relative){if(!/^(src|test)\/[a-zA-Z0-9_./-]+\.cjs$/.test(relative)||relative.split('/').includes('..'))throw Error('Unsupported test module');return require(path.join(root,relative));}
module.exports={load};
