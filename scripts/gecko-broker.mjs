// Standalone mTLS probe broker. Does not bind any existing relay/ADB port.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const commands = new Set(['status', 'capture', 'read', 'scroll']);
const boolKeys = ['activityVisible','interactive','keyguardLocked','bridgeReady'];
export function cleanState(value = {}) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const k of boolKeys) if (typeof value[k] === 'boolean') out[k] = value[k];
  for (const k of ['processId','runId']) if (/^[a-f0-9-]{36}$/.test(value[k] || '')) out[k] = value[k];
  if (/^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(value.appVersion || '')) out.appVersion = value.appVersion;
  if (['manual','user_enabled','activity_resume','boot_completed','package_replaced','sticky_restart'].includes(value.startReason)) out.startReason = value.startReason;
  return out;
}
export function cleanResult(value) {
  const allowed = ['completed','timeout','busy','bridge_unavailable','send_failed','stopped','expired','duplicate_not_replayed','invalid_command'];
  if (!value || !/^[a-f0-9-]{36}$/.test(value.id || '') || !allowed.includes(value.outcome)) throw Error('invalid_result');
  const snapshot = {};
  for (const k of ['visiblePosts','extractedCharacters','scrollBefore','scrollAfter','viewportHeight'])
    if (Number.isInteger(value.snapshot?.[k])) snapshot[k] = Math.max(0, Math.min(10000000, value.snapshot[k]));
  for (const k of ['ready','documentHidden','passwordFieldPresent','unsupportedBrowser','loginFailed','genericError','challenge'])
    if (typeof value.snapshot?.[k] === 'boolean') snapshot[k] = value.snapshot[k];
  if (['home','login','other'].includes(value.snapshot?.route)) snapshot.route = value.snapshot.route;
  return {id:value.id,outcome:value.outcome,state:cleanState(value.state),startedState:cleanState(value.startedState),snapshot};
}
export class Queue {
  devices = new Map();
  get(id) { if (!this.devices.has(id)) this.devices.set(id,{lastSeenAt:0,state:{},job:null}); return this.devices.get(id); }
  expire(d, now) {if(d.job && ['queued','delivered'].includes(d.job.status) && now>d.job.expiresAt)d.job.status=d.job.status==='queued'?'expired':'delivery_outcome_unknown';}
  enqueue(id,command,now=Date.now()) {
    if(!commands.has(command))throw Error('invalid_command');
    const d=this.get(id);this.expire(d,now);
    if(d.job&&['queued','delivered'].includes(d.job.status))throw Error('busy');
    d.job={id:crypto.randomUUID(),command,createdAt:now,expiresAt:now+60000,status:'queued'};return d.job;
  }
  poll(id,state,now=Date.now()) {
    const d=this.get(id);d.lastSeenAt=now;d.state=cleanState(state);this.expire(d,now);
    if(d.job?.status!=='queued')return {command:null};
    d.job.status='delivered';d.job.deliveredAt=now;
    return {command:{id:d.job.id,command:d.job.command,expiresAt:d.job.expiresAt}};
  }
  result(id,value) {
    const clean=cleanResult(value),d=this.get(id);this.expire(d,Date.now());
    if(d.job?.id!==clean.id||d.job.status!=='delivered')throw Error('unexpected_result');
    d.job.status='finished';d.job.result=clean;d.job.finishedAt=Date.now();return {ok:true};
  }
  status(id){const d=this.get(id);this.expire(d,Date.now());return {...d,online:Date.now()-d.lastSeenAt<20000};}
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
export function startBroker(env=process.env) {
  const queue=new Queue();
  const server=https.createServer({key:fs.readFileSync(env.TLS_KEY_PATH),cert:fs.readFileSync(env.TLS_CERT_PATH),ca:fs.readFileSync(env.TLS_CA_PATH),requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},(req,res)=>{
    const json=(code,v)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
    const match=req.url?.match(/^\/devices\/([a-zA-Z0-9_-]{1,128})\/(poll|result|command|status)$/);
    if(!match)return json(404,{error:'not_found'});
    const [,id,action]=match;
    // Reread on each request so enrollment/revocation changes take effect immediately.
    let record;
    try{record=JSON.parse(fs.readFileSync(env.RELAY_REGISTRY_PATH||'relay-devices.json','utf8')).find(r=>r.deviceId===id&&!r.revoked);}
    catch{return json(503,{error:'registry_unavailable'});}
    if(!record||!req.socket.authorized||req.socket.getPeerCertificate()?.subject?.CN!==id||!equal(record.token,String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')))return json(401,{error:'unauthorized'});
    if(action==='status'&&req.method==='GET')return json(200,queue.status(id));
    if(req.method!=='POST'||action==='status')return json(405,{error:'method_not_allowed'});
    let body='',bytes=0;req.setTimeout(10000,()=>req.destroy());
    req.on('error',()=>{});
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>32768)req.destroy();else body+=chunk;});
    req.on('end',()=>{try{
      const input=JSON.parse(body);if(!input||typeof input!=='object')throw Error('invalid_body');
      json(200,action==='poll'?queue.poll(id,input):action==='result'?queue.result(id,input):queue.enqueue(id,input.command));
    }catch(e){json(e.message==='busy'?409:400,{error:['busy','invalid_command','unexpected_result','invalid_result'].includes(e.message)?e.message:'invalid_request'});}});
  });
  server.on('tlsClientError',()=>{});
  server.listen(Number(env.GECKO_PORT||8053),env.GECKO_HOST||'0.0.0.0',()=>console.log('Gecko probe broker listening; mTLS + enrolled device token required'));
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=startBroker();
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
