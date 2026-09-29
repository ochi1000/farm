// Observe relay recovery independently of USB. Never repairs or opens the app after reboot.
import fs from 'node:fs';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const id = process.argv[2];
const record = JSON.parse(fs.readFileSync('.desktop-data/devices.json', 'utf8')).find(r => r.deviceId === id);
if (!record) throw new Error('Usage: node scripts/verify-relay-boot.mjs <enrolled-device-id> [--reboot]');
const run = promisify(execFile);
const adb = async args => (await run('adb', ['-s', record.serial, ...args], { encoding: 'utf8', timeout: 8000, windowsHide: true })).stdout.trim();
const report = { startedAt: new Date().toISOString(), deviceId: id, state: 'running', samples: [], automaticRepair: false };
const reportPath = `results/relay-boot-${id}.json`;
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const dir = `.desktop-data/pki/devices/${id}`;
const tls = { ca: fs.readFileSync('.desktop-data/pki/ca.cert.pem'), cert: fs.readFileSync(`${dir}/client.cert.pem`), key: fs.readFileSync(`${dir}/client.key.pem`) };
async function status() {
  return await new Promise(resolve => {
    const request = https.request({ ...tls, host: record.relayHost, port: Number(record.statusPort || 8051), path: `/devices/${encodeURIComponent(id)}/status`, headers: { Authorization: `Bearer ${record.deviceToken}` }, timeout: 8000 }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('error', () => resolve({ available: false }));
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ available: response.statusCode === 200 && data.deviceId === id, online: data.online === true, adbProbeOk: data.adbProbe?.ok === true, lastSeenAt: data.lastSeenAt ?? null });
        } catch { resolve({ available: false }); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ available: false }));
    request.end();
  });
}
try {
  if (await adb(['shell', 'getprop', 'ro.serialno']) !== record.serial) throw new Error('identity_mismatch');
  report.before = { model: await adb(['shell', 'getprop', 'ro.product.model']), relay: await status() };
  if (!report.before.relay.available || !report.before.relay.online) throw new Error('baseline_relay_unavailable');
  if (!process.argv.includes('--reboot')) {
    report.state = 'preflight_passed';
  } else {
    const bootId = await adb(['shell', 'cat', '/proc/sys/kernel/random/boot_id']);
    const battery = await adb(['shell', 'dumpsys', 'battery']);
    if (!(Number(battery.match(/level: (\d+)/)?.[1]) >= 25)) throw new Error('battery_too_low');
    report.rebootRequestedAt = new Date().toISOString(); save();
    await adb(['reboot']);
    const deadline = Date.now() + 180000;
    let offlineSeen = false;
    let bootChanged = false;
    while (Date.now() < deadline) {
      const sample = { at: new Date().toISOString(), ...await status() };
      report.samples.push(sample); report.heartbeatAt = sample.at;
      if (sample.available && !sample.online) offlineSeen = true;
      if (sample.available && sample.online && sample.lastSeenAt > report.before.relay.lastSeenAt && !bootChanged) {
        try { bootChanged = await adb(['shell', 'cat', '/proc/sys/kernel/random/boot_id']) !== bootId; } catch {}
      }
      if ((offlineSeen || bootChanged) && sample.available && sample.online && sample.lastSeenAt > report.before.relay.lastSeenAt) {
        report.state = 'relay_reconnected';
        report.adbReady = sample.adbProbeOk;
        break;
      }
      save();
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    report.offlineObserved = offlineSeen;
    if (report.state === 'running') report.state = 'relay_timeout';
    try {
      report.after = {
        bootChanged: await adb(['shell', 'cat', '/proc/sys/kernel/random/boot_id']) !== bootId,
        userState: await adb(['shell', 'am', 'get-started-user-state', '0']),
        tcpPort: await adb(['shell', 'getprop', 'service.adb.tcp.port']),
        supervisorPresent: (await adb(['shell', 'dumpsys', 'activity', 'services', 'com.ocorp.xrunner'])).includes('AutomationService')
      };
    } catch { report.usbObservationAvailable = false; }
  }
} catch (error) {
  report.state = 'failed';
  report.failure = ['identity_mismatch', 'baseline_relay_unavailable', 'battery_too_low'].includes(error.message) ? error.message : 'operation_failed';
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(report));
  if (!['preflight_passed', 'relay_reconnected'].includes(report.state)) process.exitCode = 1;
}
