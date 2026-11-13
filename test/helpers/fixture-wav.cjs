'use strict';
// Synthetic PCM values for format/transport tests; never recorded or played.
function wav({rate=32000,seconds=0.25,metadata=true}={}){
  const pcm=Buffer.alloc(Math.round(rate*seconds)*2,1),out=Buffer.alloc(44+pcm.length);
  out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);
  if(!metadata)return out;
  const text=Buffer.from('PRIVATE_FIXTURE_METADATA'),chunk=Buffer.alloc(8+text.length+(text.length%2));chunk.write('LIST');chunk.writeUInt32LE(text.length,4);text.copy(chunk,8);
  const result=Buffer.concat([out,chunk]);result.writeUInt32LE(result.length-8,4);return result;
}
module.exports={wav};
