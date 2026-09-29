import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-test-'));
const registry=path.join(dir,'devices.json');
const sockets=[];
let server;
async function start(){
 server=spawn(process.execPath,['scripts/relay-server.mjs'],{env:{...process.env,ALLOW_PLAINTEXT_RELAY:'true',RELAY_REGISTRY_PATH:registry,RELAY_PORT:'28050',STATUS_PORT:'28051',ADMIN_PORT:'28052',CONTROLLER_PORT:'28555',RELAY_DEVICE_TOKENS:JSON.stringify({alpha:'a'.repeat(32),beta:'b'.repeat(32)}),DEVICE_ID:'alpha'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),8000);server.stdout.on('data',chunk=>{if(String(chunk).includes('Fleet relay ready')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});});
}
async function stop(){if(!server||server.exitCode!==null)return;await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}
async function connect(port){const socket=net.connect(port,'127.0.0.1');sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});return socket;}
function frame(type,payload){const body=Buffer.from(payload),h=Buffer.alloc(8);h.writeInt32BE(type);h.writeInt32BE(body.length,4);return Buffer.concat([h,body]);}
async function phone(id,token){const socket=await connect(28050);socket.write(frame(1,JSON.stringify({deviceId:id,token,manufacturer:'Test',model:id})));let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=8){const type=buffer.readInt32BE(),size=buffer.readInt32BE(4);if(buffer.length<8+size)return;const body=buffer.subarray(8,8+size);buffer=buffer.subarray(8+size);if(type===3)socket.write(frame(3,id+':'+body));}});return socket;}
async function exchange(socket,payload){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Data timeout')),4000);socket.once('data',data=>{clearTimeout(timer);resolve(String(data));});socket.write(payload);});}
try{
 await start(); const a=await phone('alpha','a'.repeat(32));await phone('beta','b'.repeat(32));
 await new Promise(r=>setTimeout(r,100));const ca=await connect(28555),cb=await connect(28556);
 assert.deepEqual(await Promise.all([exchange(ca,'one'),exchange(cb,'two')]),['alpha:one','beta:two']);
 const enrolled=await fetch('http://127.0.0.1:28052/enroll',{method:'POST',body:JSON.stringify({deviceId:'gamma',token:'c'.repeat(32)})});
 assert.equal(enrolled.status,200);assert.equal((await enrolled.json()).controllerPort,28557);
 assert.equal(await exchange(cb,'still-active'),'beta:still-active');
 const conflict=await fetch('http://127.0.0.1:28052/enroll',{method:'POST',body:JSON.stringify({deviceId:'gamma',token:'d'.repeat(32)})});assert.equal(conflict.status,409);
 a.destroy();await new Promise(r=>setTimeout(r,100));assert.equal(await exchange(cb,'isolated'),'beta:isolated');
 await phone('alpha','a'.repeat(32));await new Promise(r=>setTimeout(r,100));assert.equal(await exchange(await connect(28555),'reconnected'),'alpha:reconnected');
 const malformed=await connect(28050);const h=Buffer.alloc(8);h.writeInt32BE(-1,4);malformed.write(h);
 assert.equal(await exchange(cb,'alive'),'beta:alive');
 const removed=await fetch('http://127.0.0.1:28052/devices/beta',{method:'DELETE'});assert.equal(removed.status,200);
 await new Promise(r=>setTimeout(r,100));const revoked=JSON.parse(fs.readFileSync(registry)).find(d=>d.deviceId==='beta');assert.equal(revoked.revoked,true);assert.equal(revoked.token,'');
 sockets.forEach(s=>s.destroy());await stop();await start();
 assert.equal(JSON.parse(fs.readFileSync(registry)).find(d=>d.deviceId==='gamma').port,28557);
 await assert.rejects(()=>connect(28556));
 const reenrolled=await fetch('http://127.0.0.1:28052/enroll',{method:'POST',body:JSON.stringify({deviceId:'beta',token:'d'.repeat(32)})});assert.equal(reenrolled.status,200);assert.equal((await reenrolled.json()).controllerPort,28556);
 await phone('beta','d'.repeat(32));await new Promise(r=>setTimeout(r,100));assert.equal(await exchange(await connect(28556),'restored'),'beta:restored');
 console.log('PASS: simultaneous routing, enrollment, revocation, re-enrollment, disconnect isolation, reconnect, malformed frames, persisted routes');
}finally{sockets.forEach(s=>s.destroy());await stop();fs.rmSync(dir,{recursive:true,force:true});}
