// Explicit, bounded reboot observation of one enrolled USB device. No account actions.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import recover from '../desktop/recovery.cjs';

if (!process.argv.includes('--reboot')) throw new Error('Use --reboot <enrolled-device-id>; leave authorized USB connected.');
const id = process.argv[process.argv.indexOf('--reboot') + 1];
const records = JSON.parse(fs.readFileSync('.desktop-data/devices.json', 'utf8'));
const record = records.find(item => item.deviceId === id);
if (!record) throw new Error('Enrolled device required');
const run = promisify(execFile);
const adb = async args => (await run('adb', args, { encoding: 'utf8', timeout: 8000, windowsHide: true })).stdout.trim();
const shell = args => adb(['-s', record.serial, 'shell', ...args]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reportPath = `results/reboot-readiness-${id}.json`;
const report = { startedAt: new Date().toISOString(), deviceId: id, state: 'running', liveSubmissions: 0 };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
async function identity() {
  return await shell(['getprop', 'ro.serialno']) === record.serial;
}
async function snapshot() {
  if (!await identity()) throw new Error('identity_mismatch');
  const services = await shell(['dumpsys', 'activity', 'services', 'com.ocorp.xrunner']);
  const pkg = await shell(['dumpsys', 'package', 'com.ocorp.xrunner']);
  const result = {
    at: new Date().toISOString(),
    appVersion: pkg.match(/versionName=(\S+)/)?.[1],
    tcpPort: await shell(['getprop', 'service.adb.tcp.port']),
    bootCompleted: await shell(['getprop', 'sys.boot_completed']) === '1',
    userUnlocked: await shell(['am', 'get-started-user-state', '0']).then(value => value === 'RUNNING_UNLOCKED').catch(() => null),
    supervisorPresent: services.includes('AutomationService')
  };
  const port = await adb(['-s', record.serial, 'forward', 'tcp:0', 'tcp:8765']);
  try {
    const relay = await (await fetch(`http://127.0.0.1:${port}/relay/status`, { signal: AbortSignal.timeout(5000) })).json();
    const probe = await (await fetch(`http://127.0.0.1:${port}/adb-probe`, { signal: AbortSignal.timeout(5000) })).json();
    result.relay = { running: relay.relay?.running, status: relay.relay?.status };
    result.adbProbeOk = probe.ok === true;
  } catch { result.localApiAvailable = false; }
  finally { await adb(['-s', record.serial, 'forward', '--remove', `tcp:${port}`]).catch(() => {}); }
  return result;
}
let rebootIssued = false;
try {
  report.before = await snapshot();
  if (!report.before.adbProbeOk) throw new Error('baseline_adb_probe_failed');
  const bootId = await shell(['cat', '/proc/sys/kernel/random/boot_id']);
  save();
  await adb(['-s', record.serial, 'reboot']);
  rebootIssued = true;
  report.stage = 'waiting_for_reboot'; save();
  const deadline = Date.now() + 120000;
  let returned = false;
  while (Date.now() < deadline) {
    await delay(5000);
    report.heartbeatAt = new Date().toISOString(); save();
    try {
      if (await identity() && await shell(['cat', '/proc/sys/kernel/random/boot_id']) !== bootId && await shell(['getprop', 'sys.boot_completed']) === '1') {
        returned = true; break;
      }
    } catch { /* Expected while USB is disconnected during reboot. */ }
  }
  report.bootChangedAndCompleted = returned; save();
  if (!returned) throw new Error('boot_timeout');
  // Give BOOT_COMPLETED service startup a bounded window; do not launch the app.
  await delay(15000);
  report.afterBoot = await snapshot();
  report.unassistedLocalAdbReady = report.afterBoot.adbProbeOk === true;
  report.state = report.unassistedLocalAdbReady ? 'local_adb_restored' : 'requires_provisioning';
} catch (error) {
  report.state = 'failed';
  report.failure = ['identity_mismatch', 'baseline_adb_probe_failed', 'boot_timeout'].includes(error.message) ? error.message : 'operation_failed';
} finally {
  if (rebootIssued) {
    // Restore the existing USB-assisted configuration after measuring unassisted boot.
    try {
      if (await identity()) {
        report.usbRecovery = await recover(record, {
          connect: async () => { throw new Error('Measured USB recovery'); },
          exec: async (command, args, timeout) => {
            try { return { ok: true, ...await run(command, args, { encoding: 'utf8', timeout, windowsHide: true }) }; }
            catch { return { ok: false, stdout: '', stderr: '' }; }
          }
        });
        await delay(3000);
        report.afterRecovery = await snapshot();
      }
    } catch { report.usbRecovery = { ok: false }; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(report));
  if (report.state !== 'local_adb_restored') process.exitCode = 1;
}
