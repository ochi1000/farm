import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const plain = process.env.ALLOW_PLAINTEXT_RELAY === 'true';
const registryPath = process.env.RELAY_REGISTRY_PATH || path.resolve('relay-devices.json');
const basePort = Number(process.env.CONTROLLER_PORT || 15555);
const records = new Map();
const devices = new Map();
const controllers = new Map();
const routes = new Map();
const tlsOptions = plain ? null : {
  key: fs.readFileSync(process.env.TLS_KEY_PATH),
  cert: fs.readFileSync(process.env.TLS_CERT_PATH),
  ca: fs.readFileSync(process.env.TLS_CA_PATH),
  requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2'
};
if (fs.existsSync(registryPath)) {
  for (const record of JSON.parse(fs.readFileSync(registryPath, 'utf8'))) records.set(record.deviceId, record);
}
const seeds = JSON.parse(process.env.RELAY_DEVICE_TOKENS || '{}');
if (process.env.DEVICE_ID && process.env.RELAY_TOKEN && !seeds[process.env.DEVICE_ID]) seeds[process.env.DEVICE_ID] = process.env.RELAY_TOKEN;
const seedIds = Object.keys(seeds).sort((a,b) => a === process.env.DEVICE_ID ? -1 : b === process.env.DEVICE_ID ? 1 : a.localeCompare(b));
for (const deviceId of seedIds) {
  if (!records.has(deviceId)) records.set(deviceId, { deviceId, token: seeds[deviceId], port: allocatePort() });
}
function allocatePort() {
  const used = new Set([...records.values()].map(r => r.port));
  for(let port=basePort;port<65536;port++) if(!used.has(port)) return port;
  throw new Error('Route port range exhausted');
}
function persist() {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  const temporary = registryPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify([...records.values()], null, 2), {mode:0o600});
  fs.renameSync(temporary, registryPath);
}
function send(socket,type,payload=Buffer.alloc(0)) {
  if (!socket || socket.destroyed) return;
  if(socket.writableLength > 8*1024*1024) return socket.destroy();
  const header=Buffer.alloc(8);header.writeInt32BE(type);header.writeInt32BE(payload.length,4);
  socket.write(Buffer.concat([header,payload]));
}
function closeController(deviceId, expected) {
  const current=controllers.get(deviceId);
  if (!current || (expected && expected!==current)) return;
  controllers.delete(deviceId); current.destroy(); send(devices.get(deviceId)?.socket,4);
}
function online(deviceId) {
  const d=devices.get(deviceId);
  return !!(d && !d.socket.destroyed && Date.now()-d.lastSeen<45000);
}
async function openRoute(record) {
  if(routes.has(record.deviceId)) return;
  const server=net.createServer(socket=>{
    if(!online(record.deviceId)||controllers.has(record.deviceId)) return socket.destroy();
    controllers.set(record.deviceId,socket);
    socket.setKeepAlive(true);
    socket.on('data',data=>send(devices.get(record.deviceId)?.socket,3,data));
    socket.on('close',()=>closeController(record.deviceId,socket));
    socket.on('error',()=>closeController(record.deviceId,socket));
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(record.port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  server.on('error',error=>console.error('Route error',record.deviceId,error.message));
  routes.set(record.deviceId,server);
}
function equal(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function authenticated(socket,id,token) {
  const record=records.get(id);
  return !!record&&!record.revoked&&(plain||socket.getPeerCertificate()?.subject?.CN===id)&&equal(record.token,token);
}
function phone(socket) {
  let buffer=Buffer.alloc(0),deviceId='';
  const authTimer=setTimeout(()=>socket.destroy(),10000);
  socket.setKeepAlive(true);
  socket.on('data',chunk=>{
    try {
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=8) {
        const type=buffer.readInt32BE(0),size=buffer.readInt32BE(4);
        if(size<0||size>1024*1024)throw new Error('Invalid frame');
        if(buffer.length<8+size)break;
        const payload=buffer.subarray(8,8+size);buffer=buffer.subarray(8+size);
        if(type===1) {
          if(deviceId)throw new Error('Repeated hello');
          const hello=JSON.parse(payload);
          if(!authenticated(socket,hello.deviceId,hello.token))throw new Error('Authentication failed');
          deviceId=hello.deviceId;clearTimeout(authTimer);
          closeController(deviceId);
          devices.get(deviceId)?.socket.destroy();
          devices.set(deviceId,{socket,hello,lastSeen:Date.now(),heartbeat:null});
          console.log('Phone online',deviceId);
        } else {
          const d=devices.get(deviceId);
          if(!d||d.socket!==socket)throw new Error('Unauthenticated frame');
          if(type===2){d.lastSeen=Date.now();if(payload.length)d.heartbeat=JSON.parse(payload);}
          else if(type===3){
            const controller=controllers.get(deviceId);
            if(controller?.writableLength>8*1024*1024)closeController(deviceId);
            else controller?.write(payload);
          } else if(type===4)closeController(deviceId);
        }
      }
    } catch { socket.destroy(); }
  });
  socket.on('error',()=>socket.destroy());
  socket.on('close',()=>{
    clearTimeout(authTimer);
    if(devices.get(deviceId)?.socket===socket){closeController(deviceId);console.log('Phone offline',deviceId);}
  });
}
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function status(req,res) {
  const match=req.url?.match(/^\/devices\/([a-zA-Z0-9_-]+)\/status$/);
  if(req.method!=='GET'||!match)return json(res,404,{error:'not_found'});
  const id=match[1],token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!authenticated(req.socket,id,token))return json(res,401,{error:'unauthorized'});
  const d=devices.get(id);
  json(res,200,{ok:true,deviceId:id,online:online(id),controllerPort:records.get(id).port,
    model:d? [d.hello.manufacturer,d.hello.model].join(' '):null,sdk:d?.hello.sdk??null,
    lastSeenAt:d?.lastSeen??null,adbProbe:d?.heartbeat?.adbProbe??null});
}
let enrollmentQueue=Promise.resolve();
const admin=http.createServer((req,res)=>{
  const removal=req.url?.match(/^\/devices\/([a-zA-Z0-9_-]+)$/);
  if(req.method==='DELETE'&&removal){
    enrollmentQueue=enrollmentQueue.then(async()=>{
      const deviceId=removal[1],record=records.get(deviceId);
      if(!record||record.revoked)return json(res,404,{error:'device_not_found'});
      closeController(deviceId);
      const device=devices.get(deviceId);devices.delete(deviceId);device?.socket.destroy();
      const route=routes.get(deviceId);
      if(route)await new Promise(resolve=>route.close(resolve));
      routes.delete(deviceId);
      records.set(deviceId,{deviceId,port:record.port,token:'',revoked:true});
      persist();
      json(res,200,{ok:true,deviceId});
    }).catch(()=>json(res,500,{error:'removal_failed'}));
    return;
  }
  if(req.method!=='POST'||req.url!=='/enroll')return json(res,404,{error:'not_found'});
  let bytes=0,body='';
  req.setTimeout(10000,()=>req.destroy());
  req.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)req.destroy();else body+=chunk;});
  req.on('end',()=>{
    enrollmentQueue=enrollmentQueue.then(async()=>{
      const input=JSON.parse(body);
      if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input.deviceId)||typeof input.token!=='string'||input.token.length<32) return json(res,400,{error:'invalid_enrollment'});
      const existing=records.get(input.deviceId);
      if(existing&&!existing.revoked&&!equal(existing.token,input.token))return json(res,409,{error:'device_already_registered_with_different_token'});
      if([...records.values()].some(r=>!r.revoked&&r.deviceId!==input.deviceId&&equal(r.token,input.token)))return json(res,409,{error:'token_already_used'});
      const record=existing&&!existing.revoked?existing:{deviceId:input.deviceId,token:input.token,port:existing?.port||allocatePort(),revoked:false};
      await openRoute(record);
      records.set(record.deviceId,record);
      try {persist();}catch(error){routes.get(record.deviceId)?.close();routes.delete(record.deviceId);if(existing)records.set(existing.deviceId,existing);else records.delete(record.deviceId);throw error;}
      json(res,200,{ok:true,deviceId:record.deviceId,controllerPort:record.port});
    }).catch(()=>json(res,500,{error:'enrollment_failed'}));
  });
});
for(const record of records.values())if(!record.revoked)await openRoute(record);
persist();
const relay=plain?net.createServer(phone):tls.createServer(tlsOptions,phone);
relay.on('tlsClientError',()=>{});
const api=plain?http.createServer(status):https.createServer(tlsOptions,status);
relay.listen(Number(process.env.RELAY_PORT||8050),process.env.RELAY_HOST||'0.0.0.0');
api.listen(Number(process.env.STATUS_PORT||8051),process.env.STATUS_HOST||'0.0.0.0');
admin.listen(Number(process.env.ADMIN_PORT||8052),'127.0.0.1');
const timer=setInterval(()=>{
  for(const [id,d] of devices){if(!online(id))d.socket.destroy();else send(d.socket,2);}
},15000);
function shutdown(){
 clearInterval(timer);for(const socket of controllers.values())socket.destroy();
 for(const d of devices.values())d.socket.destroy();for(const route of routes.values())route.close();
 relay.close();api.close();admin.close();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
console.log('Fleet relay ready:',routes.size,'routes; viewing off until requested');
