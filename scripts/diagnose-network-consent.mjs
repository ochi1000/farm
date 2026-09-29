// Read-only USB snapshot. Never persist raw dumps, network names or ADB keys.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [id, label = 'current'] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Invalid snapshot label');
const devices = JSON.parse(fs.readFileSync('.desktop-data/devices.json', 'utf8').replace(/^\uFEFF/, ''));
const record = devices.find(r => r.deviceId === id);
if (!record) throw new Error('Enrolled device required');
const adb = args => execFileSync('adb', ['-s', record.serial, ...args], {
  encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
}).trim();
const report = { at: new Date().toISOString(), deviceId: id, label, readOnly: true };
try {
  report.identityMatched = adb(['shell', 'getprop', 'ro.serialno']) === record.serial;
  if (!report.identityMatched) throw new Error();
  report.bootId = adb(['shell', 'cat', '/proc/sys/kernel/random/boot_id']);
  report.userState = adb(['shell', 'am', 'get-started-user-state', '0']);
  report.wirelessEnabled = adb(['shell', 'settings', 'get', 'global', 'adb_wifi_enabled']) === '1';
  const wifi = adb(['shell', 'cmd', 'wifi', 'status']);
  const bssid = wifi.match(/BSSID:\s*([0-9a-f:]{17})/i)?.[1]?.toLowerCase();
  report.accessPointObserved = !!bssid && bssid !== '02:00:00:00:00:00';
  if (report.accessPointObserved) report.accessPointHash = crypto.createHash('sha256').update(bssid).digest('hex');
  const dump = adb(['shell', 'dumpsys', 'adb']);
  // Some firmware exposes XML network entries in dumpsys; absence is inconclusive.
  const trusted = [...dump.matchAll(/<wifiAP\b[^>]*\bbssid="([0-9a-f:]{17})"/gi)].map(m => m[1].toLowerCase());
  report.trustEntriesVisible = trusted.length > 0;
  report.currentAccessPointInVisibleEntries = report.accessPointObserved && trusted.length ? trusted.includes(bssid) : null;
  const logs = adb(['logcat', '-d', '-t', '1500', '-s', 'AdbDebuggingManager']);
  report.logSignals = {
    persistenceError: /exception writing the key map|Unable to obtain the key file.*writing/i.test(logs),
    parsingError: /exception parsing the XML key file|keystore version.*not supported/i.test(logs)
  };
  report.state = 'captured';
} catch { report.state = 'usb_snapshot_unavailable'; process.exitCode = 1; }
fs.writeFileSync(`results/network-consent-${id}-${label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
