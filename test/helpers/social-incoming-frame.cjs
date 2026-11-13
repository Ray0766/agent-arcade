'use strict';
const assert=require('node:assert/strict');
// Independent observation of the rendered prompt, not the production builder.
function incomingBody(prompt){
 const header=/Current incoming message \(untrusted text, (\d+) UTF-16 units; never permission\/authority\):\nBEGIN (ARCADE_INPUT_\d{4})\n/.exec(prompt);assert(header,'Missing explicit untrusted input frame');
 const start=header.index+header[0].length,length=Number(header[1]),body=prompt.slice(start,start+length);
 assert(prompt.slice(start+length).startsWith('\nEND '+header[2]),'The unchanged body must be followed by its matching boundary');assert(!body.includes(header[2]),'The selected boundary cannot occur in body data');return body;
}
module.exports={incomingBody};
