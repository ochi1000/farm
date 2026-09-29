const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function createFleet({ root, readDevices, readSettings, exec, checkRelayDevice, runAction, viewer }) {
  const tunnels = new Map(), pending = new Map();
  let enrolling = false;
  const save = record => {
    const records = readDevices();
    const index = records.findIndex(d => d.deviceId === record.deviceId);
    if(index < 0) records.push(record); else records[index] = record;
    fs.writeFileSync(path.join(root,'.desktop-data/devices.json'),JSON.stringify(records,null,2));
  };
  function ssh(record) {
    const settings=readSettings();
    const host=record.relayHost, user=settings.sshUser, key=settings.sshKeyPath;
    if(!/^[a-zA-Z0-9.-]+$/.test(host)||!/^[a-zA-Z0-9_-]+$/.test(user)||!key||!fs.existsSync(key))throw new Error('Configure VPS SSH host, username and key first.');
    return ['-T','-i',key,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',user+'@'+host];
  }
  async function connect(record) {
    if(pending.has(record.deviceId))return pending.get(record.deviceId);
    const task=connectInternal(record).finally(()=>pending.delete(record.deviceId));
    pending.set(record.deviceId,task); return task;
  }
  async function connectInternal(record) {
    const status=await checkRelayDevice({host:record.relayHost,statusPort:record.statusPort,deviceId:record.deviceId,token:record.deviceToken});
    if(!status.ok)throw new Error(status.message);
    if(status.relayStatus?.adbProbe?.ok!==true)throw new Error('Relay is online, but remote ADB is not enabled. Connect this phone by USB once and run device setup again.');
    const remotePort=status.relayStatus.controllerPort;
    if(!Number.isInteger(remotePort)||remotePort<1||remotePort>65535)throw new Error('VPS needs the fleet relay update.');
    let tunnel=tunnels.get(record.deviceId);
    if(tunnel && (tunnel.child.exitCode!==null||tunnel.child.killed)){tunnels.delete(record.deviceId);tunnel=null;}
    if(!tunnel){
      const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
      const args=ssh(record);const destination=args.pop();
      const child=spawn('ssh',[...args,'-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-L',`127.0.0.1:${port}:127.0.0.1:${remotePort}`,destination],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
      let error='';child.stderr.on('data',chunk=>error=(error+chunk).slice(-2048));child.on('error',e=>error=e.message);
      tunnel={child,serial:`127.0.0.1:${port}`};tunnels.set(record.deviceId,tunnel);
      child.once('exit',()=>{if(tunnels.get(record.deviceId)===tunnel)tunnels.delete(record.deviceId);void stopView(record.deviceId);});
      let ready=false;
      for(let attempt=0;attempt<120;attempt++){
        if(child.exitCode!==null||child.killed)break;
        ready=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.setTimeout(150);const done=v=>{s.destroy();resolve(v);};s.once('connect',()=>done(true));s.once('error',()=>done(false));s.once('timeout',()=>done(false));});
        if(ready)break;await new Promise(r=>setTimeout(r,250));
      }
      if(!ready){child.kill();tunnels.delete(record.deviceId);throw new Error(error||'SSH tunnel failed to open.');}
      // Let the relay release the short readiness probe before ADB opens its transport.
      await new Promise(r=>setTimeout(r,400));
    }
    const result=await exec('adb',['connect',tunnel.serial],20000);
    const state=await exec('adb',['-s',tunnel.serial,'get-state'],10000);
    if(!result.ok||state.stdout.trim()!=='device')throw new Error('Remote ADB unavailable. Check debugging authorization on the phone.');
    return tunnel.serial;
  }
  async function stopView(id){await viewer.stop(id);}
  function stopTunnel(id){const tunnel=tunnels.get(id);if(tunnel){tunnels.delete(id);tunnel.child.kill();}}
  async function view(record,chrome=false){
    const serial=await connect(record);
    return await viewer.start(record,serial,chrome?'chrome':'phone');
  }
  async function enroll(options){
    if(enrolling)throw new Error('Another phone is being enrolled.');
    enrolling=true;
    try{
      for(const file of ['ca.key.pem','ca.cert.pem']) if(!fs.existsSync(path.join(root,'.desktop-data/pki',file)))throw new Error('Import the existing relay CA before enrolling phones.');
      if(!options.serial)throw new Error('Select the connected phone.');
      const name=String(options.name||'').trim();
      if(!name)throw new Error('Enter a device name.');
      ssh({relayHost:options.host||readSettings().relayHost});
      const prepared=await runAction('usbBootstrap',options);
      if(!prepared.ok)throw new Error(prepared.message);
      const deviceId=prepared.deviceId;
      if(!/^[a-zA-Z0-9_-]+$/.test(deviceId))throw new Error('Invalid phone identity.');
      const previous=readDevices().find(d=>d.deviceId===deviceId);
      const record={...previous,deviceId,name:name.slice(0,80),serial:options.serial,wirelessTarget:prepared.wirelessTarget,relayHost:options.host||readSettings().relayHost,statusPort:options.statusPort||'8051',deviceToken:previous?.deviceToken||crypto.randomBytes(32).toString('hex'),enrollment:'pending'};
      save(record);
      const directory=path.join(root,'.desktop-data/pki/devices',deviceId);
      if(!['client.p12','client-password.txt','client.cert.pem','client.key.pem'].every(file=>fs.existsSync(path.join(directory,file)))){
        const generated=await runAction('generateMtls',{host:record.relayHost,deviceId});if(!generated.ok)throw new Error(generated.message);
      }
      const registered=await exec('ssh',[...ssh(record),'node /opt/all-in-relay/relay-enroll.mjs'],25000,JSON.stringify({deviceId,token:record.deviceToken}));
      if(!registered.ok)throw new Error('VPS enrollment failed: '+(registered.stdout||registered.stderr));
      record.controllerPort=JSON.parse(registered.stdout).controllerPort;save(record);
      const wait=await exec('adb',['-s',options.serial,'wait-for-device'],20000);if(!wait.ok)throw new Error('Reconnect the phone and retry enrollment.');
      const provisioned=await runAction('provisionMtls',{serial:options.serial,deviceId});if(!provisioned.ok)throw new Error(provisioned.message);
      const started=await runAction('secureRelayStart',{serial:options.serial,deviceId,host:record.relayHost,token:record.deviceToken});if(!started.ok)throw new Error(started.message);
      let phoneRelayError='';
      for(let attempt=0;attempt<20;attempt++){
        const status=await checkRelayDevice({host:record.relayHost,statusPort:record.statusPort,deviceId,token:record.deviceToken});
        if(status.ok){record.enrollment='complete';save(record);return deviceId;}
        const localStatus=await runAction('relayStatus',{serial:options.serial});
        try{phoneRelayError=JSON.parse(localStatus.stdout)?.relay?.lastError||phoneRelayError;}catch{}
        if(/ENETUNREACH|Network is unreachable/i.test(phoneRelayError))throw new Error('Connect the phone to Wi-Fi or mobile data, then retry setup.');
        await new Promise(r=>setTimeout(r,1000));
      }
      if(/timed out|EHOSTUNREACH|ECONNREFUSED/i.test(phoneRelayError))throw new Error('The phone cannot reach the device service. Check its internet connection and retry setup.');
      throw new Error(phoneRelayError ? `Secure connection failed: ${phoneRelayError}` : 'The phone did not connect to the device service. Check its internet connection and retry setup.');
    }finally{enrolling=false;}
  }
  async function remove(record){
    if(!record||!/^[a-zA-Z0-9_-]{1,128}$/.test(record.deviceId||''))throw new Error('Select a registered device.');
    await stopView(record.deviceId);stopTunnel(record.deviceId);
    const phoneStop=await runAction('stopRelayForDevice',{serial:record.serial,wirelessTarget:record.wirelessTarget});
    const removed=await exec('ssh',[...ssh(record),'node /opt/all-in-relay/relay-remove.mjs'],25000,JSON.stringify({deviceId:record.deviceId}));
    let response={};try{response=JSON.parse(removed.stdout);}catch{}
    if(!removed.ok&&response.error!=='device_not_found')throw new Error('Could not revoke the device on the VPS. Nothing was deleted locally.');
    fs.writeFileSync(path.join(root,'.desktop-data/devices.json'),JSON.stringify(readDevices().filter(device=>device.deviceId!==record.deviceId),null,2));
    const certificateRoot=path.resolve(root,'.desktop-data/pki/devices');
    const certificateDirectory=path.resolve(certificateRoot,record.deviceId);
    if(certificateDirectory.startsWith(certificateRoot+path.sep))fs.rmSync(certificateDirectory,{recursive:true,force:true});
    return {phoneStopped:phoneStop.ok};
  }
  return {
    connect,
    view,
    stopView,
    enroll,
    remove,
    input: viewer.input,
    isViewing: viewer.isViewing,
    viewMode: viewer.mode,
    shutdown: async()=>{await viewer.shutdown();for(const id of tunnels.keys())stopTunnel(id);}
  };
};
