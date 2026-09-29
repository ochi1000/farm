// One request only. No ADB, automatic retry, polling or account content export.
import fs from 'node:fs';
import https from 'node:https';
const [id,command='status']=process.argv.slice(2);
try {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id||'')||!['status','capture','read','scroll','device-status'].includes(command))throw Error('usage');
  const record=JSON.parse(fs.readFileSync('.desktop-data/devices.json','utf8').replace(/^\uFEFF/, '')).find(r=>r.deviceId===id);
  if(!record)throw Error('not_enrolled');
  const directory=`.desktop-data/pki/devices/${id}`;
  const action=command==='status'?'status':'command';
  const payload=JSON.stringify({command:command==='device-status'?'status':command});
  const data=await new Promise((resolve,reject)=>{
    const req=https.request({host:record.relayHost,port:Number(process.env.GECKO_PORT||8053),path:`/devices/${id}/${action}`,method:action==='status'?'GET':'POST',
      ca:fs.readFileSync('.desktop-data/pki/ca.cert.pem'),cert:fs.readFileSync(`${directory}/client.cert.pem`),key:fs.readFileSync(`${directory}/client.key.pem`),
      headers:{Authorization:`Bearer ${record.deviceToken}`,'Content-Type':'application/json'},timeout:10000},res=>{
        let body='';res.on('data',chunk=>{body+=chunk;if(body.length>65536)res.destroy();});res.on('error',reject);
        res.on('end',()=>{try{const v=JSON.parse(body);if(res.statusCode!==200)reject(Error(v.error||'http_error'));else resolve(v);}catch{reject(Error('invalid_response'));}});
      });
    req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',reject);req.end(action==='status'?undefined:payload);
  });
  fs.mkdirSync('results',{recursive:true});
  fs.writeFileSync(`results/gecko-remote-${id}-${Date.now()}.json`,JSON.stringify({at:new Date().toISOString(),deviceId:id,request:command,data},null,2));
  console.log(JSON.stringify(data,null,2));
} catch(e){console.error('Gecko command failed:',/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:'connection_or_configuration_error');process.exitCode=1;}
