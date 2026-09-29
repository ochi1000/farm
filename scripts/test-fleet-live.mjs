import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['desktop/main.cjs'],env});
try{
 const page=await app.firstWindow();
 const records=await page.evaluate(()=>window.phoneRelay.runAction('fleetList'));
 assert.ok(records.devices.length,'No registered phone');
 assert.equal(records.devices.some(d=>d.viewing),false);
 const device=records.devices.find(d=>d.state==='Online');assert.ok(device,'No phone online');
 const settings=await page.evaluate(()=>window.phoneRelay.getSettings());
 if(!process.argv.includes('--view-only')){
   const enrollment=await page.evaluate(o=>window.phoneRelay.runAction('fleetEnroll',o),{name:device.name,serial:settings.wirelessTarget,host:device.relayHost,statusPort:device.statusPort});
   assert.equal(enrollment.ok,true);console.log('PASS: live enrollment through SSH, provisioning and mTLS');
 }
 const connected=await page.evaluate(deviceId=>window.phoneRelay.runAction('fleetAction',{deviceId,command:'remoteAdbConnect'}),device.deviceId);
 assert.equal(connected.ok,true);console.log('PASS: per-device SSH/ADB route');
 const before=await page.evaluate(()=>window.phoneRelay.runAction('fleetList'));assert.equal(before.devices.some(d=>d.viewing),false);
 const viewed=await page.evaluate(()=>window.phoneRelay.runAction('fleetViewAll'));assert.ok(viewed.message.includes(': viewing'),viewed.message);
 const during=await page.evaluate(()=>window.phoneRelay.runAction('fleetList'));assert.equal(during.devices.find(d=>d.deviceId===device.deviceId).viewing,true);
 await page.evaluate(()=>window.phoneRelay.runAction('fleetStopAll'));
 const after=await page.evaluate(()=>window.phoneRelay.runAction('fleetList'));assert.equal(after.devices.some(d=>d.viewing),false);
 console.log('PASS: viewing off on connect; View all starts scrcpy; Stop all clears viewers');
 await page.screenshot({path:'dist/fleet-live.png',fullPage:true});
}finally{await app.close();}
