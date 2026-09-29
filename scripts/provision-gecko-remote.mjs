// User-run, one-time USB provisioning. Secrets go only over stdin into app-private storage.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const id=process.argv[2];
function adb(serial,args,input){return new Promise((resolve,reject)=>{
  const p=spawn('adb',['-s',serial,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  p.stdout.on('data',b=>out+=b);p.stderr.resume();p.on('error',()=>reject(Error('adb_unavailable')));
  const timer=setTimeout(()=>{p.kill();reject(Error('adb_timeout'));},15000);
  p.on('close',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(Error('adb_failed'));});
  p.stdin.on('error',()=>{});p.stdin.end(input);
});}
try{
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id||''))throw Error('enrolled_device_id_required');
  const record=JSON.parse(fs.readFileSync('.desktop-data/devices.json','utf8').replace(/^\uFEFF/,'')).find(r=>r.deviceId===id);
  if(!record)throw Error('device_not_enrolled');
  if(await adb(record.serial,['shell','getprop','ro.serialno'])!==record.serial)throw Error('identity_mismatch');
  const dir=`.desktop-data/pki/devices/${id}`;
  const endpoint=new URL(`https://${record.relayHost}:${Number(process.env.GECKO_PORT||8053)}`);
  const config=JSON.stringify({deviceId:id,endpoint:endpoint.origin,token:record.deviceToken,
    ca:fs.readFileSync('.desktop-data/pki/ca.cert.pem','utf8'),p12:fs.readFileSync(`${dir}/client.p12`).toString('base64'),p12Password:fs.readFileSync(`${dir}/client-password.txt`,'utf8').trim()});
  await adb(record.serial,['shell','run-as','com.ocorp.geckoprobe','sh','-c',"'umask 077; mkdir -p files; cat > files/remote-config.tmp && mv files/remote-config.tmp files/remote-config.json'"],config);
  console.log('Gecko remote configuration installed for verified device. Open app and tap Enable service. No credentials printed.');
}catch(e){console.error('Provisioning failed:',/^[a-z_]+$/.test(e.message)?e.message:'configuration_error');process.exitCode=1;}
