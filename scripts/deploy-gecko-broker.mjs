// Run explicitly by user after local verification. No key/token material uploaded.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function run(cmd,args,input){return new Promise((resolve,reject)=>{
  const p=spawn(cmd,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  p.stdout.on('data',b=>out+=b);p.stderr.resume();p.stdin.on('error',()=>{});p.stdin.end(input);
  const timer=setTimeout(()=>{p.kill();reject(Error('command_timeout'));},45000);
  p.on('error',()=>{clearTimeout(timer);reject(Error('command_unavailable'));});
  p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('remote_command_failed'));});
});}
try{
  const record=read('.desktop-data/devices.json').find(r=>r.deviceId===process.argv[2]),settings=read('.desktop-data/settings.json');
  if(!record||!/^[a-zA-Z0-9.-]+$/.test(record.relayHost)||!/^[a-zA-Z0-9_-]+$/.test(settings.sshUser)||!fs.existsSync(settings.sshKeyPath))throw Error('ssh_configuration_invalid');
  const args=['-T','-i',settings.sshKeyPath,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',`${settings.sshUser}@${record.relayHost}`];
  if(process.argv[3]==='status'){
    console.log((await run('ssh',[...args,'systemctl is-active gecko-probe-broker'])).trim());
  }else if(process.argv[3]==='install'){
    const stage=`/tmp/gecko-probe-${crypto.randomUUID()}`;
    await run('ssh',[...args,`mkdir -m 700 ${stage}`]);
    await run('ssh',[...args,`cat > ${stage}/broker.mjs`],fs.readFileSync('scripts/gecko-broker.mjs'));
    await run('ssh',[...args,`cat > ${stage}/broker.service`],fs.readFileSync('deploy/gecko-probe-broker.service'));
    // Constant paths match the repository's existing VPS deployment unit.
    await run('ssh',[...args,`sudo -n test -r /etc/all-in-relay.env && sudo -n test -r /opt/all-in-relay/relay-devices.json && node --check ${stage}/broker.mjs && sudo -n install -m 644 ${stage}/broker.mjs /opt/all-in-relay/gecko-broker.mjs && sudo -n install -m 644 ${stage}/broker.service /etc/systemd/system/gecko-probe-broker.service && sudo -n systemctl daemon-reload && sudo -n systemctl enable gecko-probe-broker && sudo -n systemctl restart gecko-probe-broker`]);
    console.log('Broker unit installed/started. Confirm status and mTLS reachability on TCP 8053; firewall not changed. Existing relay not restarted.');
  }else throw Error('usage_device_id_install_or_status');
}catch(e){console.error('Broker deployment:',/^[a-z_]+$/.test(e.message)?e.message:'configuration_error');process.exitCode=1;}
