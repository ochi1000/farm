import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const adb = args => execFileSync('adb', args, { encoding: 'utf8', timeout: 60000, windowsHide: true });
const available = adb(['devices']).split(/\r?\n/).filter(line => /\sdevice$/.test(line.trim())).map(line => line.trim().split(/\s+/)[0]);
const records = JSON.parse(fs.readFileSync('.desktop-data/devices.json', 'utf8'));
const matches = records.flatMap(record => available.filter(serial => serial === record.serial || serial === record.wirelessTarget).map(serial => ({ record, serial })));
if (matches.length !== 1) throw new Error('Exactly one connected enrolled device is required');
const { record, serial } = matches[0];
const shell = args => adb(['-s', serial, 'shell', ...args]);
if (shell(['getprop', 'ro.serialno']).trim() !== record.serial) throw new Error('Device identity mismatch');
const report = { at: new Date().toISOString(), deviceId: record.deviceId, android: shell(['getprop', 'ro.build.version.release']).trim() };
const before = shell(['dumpsys', 'activity', 'services', 'com.ocorp.xrunner']);
report.before = { servicePresent: before.includes('AutomationService'), serviceType: before.match(/\btypes=(0x[0-9a-f]+)/)?.[1] };
if (process.argv.includes('--install')) {
  const install = adb(['-s', serial, 'install', '-r', 'android-x-runner/app/build/outputs/apk/debug/app-debug.apk']);
  if (!install.includes('Success')) throw new Error('APK installation failed');
  report.installed = true;
}
const launched = shell(['am', 'start', '-n', 'com.ocorp.xrunner/.MainActivity']);
if (/Error|Exception/.test(launched)) throw new Error('App launch failed');
await new Promise(resolve => setTimeout(resolve, 4000));
const after = shell(['dumpsys', 'activity', 'services', 'com.ocorp.xrunner']);
report.after = { servicePresent: after.includes('AutomationService'), serviceType: after.match(/\btypes=(0x[0-9a-f]+)/)?.[1], powerExempt: shell(['cmd', 'deviceidle', 'whitelist']).includes('com.ocorp.xrunner'), version: shell(['dumpsys', 'package', 'com.ocorp.xrunner']).match(/versionName=(\S+)/)?.[1] };
const port = adb(['-s', serial, 'forward', 'tcp:0', 'tcp:8765']).trim();
try {
  const state = await (await fetch(`http://127.0.0.1:${port}/relay/status`, { signal: AbortSignal.timeout(5000) })).json();
  report.relay = { running: state.relay?.running, status: state.relay?.status, reconnectAttempt: state.relay?.reconnectAttempt };
} finally { adb(['-s', serial, 'forward', '--remove', `tcp:${port}`]); }
fs.writeFileSync('results/recovery-live.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
