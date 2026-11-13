'use strict';
// Synthetic ZIP/remote only, with production extraction and real private local files.
const B=require('./qq-remote-copy-fixture.cjs'),{QQRemoteFileExtract}=require('../../src/bot/qq-remote-files-extract.cjs');
const entries=()=>[['binary.bin',Buffer.from([0,255,42,13,10])],['outer/empty/',null],['outer/nested/文字.txt','synthetic-api-key=original\0原始内容'],['zero.dat',Buffer.alloc(0)]];
async function fixture(t,{archiveEntries=entries(),archiveBytes,name='bundle.zip'}={}){const f=B.fixture(t),bytes=archiveBytes||await B.zip(archiveEntries);f.state.add(B.ROOT+'/'+name,'file',bytes);f.session.fileExtractFactory=args=>new QQRemoteFileExtract({...args,paceMs:0});return {...f,get files(){return f.files;},archiveBytes:Buffer.from(bytes),archiveName:name,extractPreview:(destinationId=f.entry('destination').entryId)=>f.preview('extract',[f.entry(name).entryId],{destinationId})};}
module.exports={fixture,entries,...Object.fromEntries(['ROOT','EXPECTED','TOKEN','zip','deferred','flush'].map(k=>[k,B[k]]))};
