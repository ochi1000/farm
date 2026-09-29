// Identity-bound remote ADB/CDP smoke. No account navigation or publication.
import fs from 'node:fs';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import createFleet from '../desktop/fleet.cjs';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const records = read('.desktop-data/devices.json');
const record = records.find(r => r.deviceId === process.argv[2]);
if (!record) throw new Error('Enrolled device ID required');
const run = promisify(execFile);
const report = { startedAt: new Date().toISOString(), deviceId: record.deviceId, liveSubmissions: 0 };
const exec = async (command, args, timeout) => {
    try {
        const result = await run(command, args, { encoding: 'utf8', timeout, windowsHide: true });
        if (command === 'adb' && args[0] === 'connect') report.adbConnect = {
            connected: /connected to/.test(result.stdout),
            authenticationFailed: /authenticate|unauthorized/i.test(result.stdout),
            refused: /refused/i.test(result.stdout),
            closed: /closed/i.test(result.stdout), reset: /reset/i.test(result.stdout),
            timedOut: /timed out|timeout/i.test(result.stdout), protocolFault: /protocol fault/i.test(result.stdout)
        };
        return { ok: true, ...result };
    }
    catch { return { ok: false, stdout: '', stderr: '' }; }
};
const checkRelayDevice = async () => await new Promise(resolve => {
    const dir = `.desktop-data/pki/devices/${record.deviceId}`;
    const request = https.request({
        host: record.relayHost, port: Number(record.statusPort || 8051),
        path: `/devices/${encodeURIComponent(record.deviceId)}/status`,
        ca: fs.readFileSync('.desktop-data/pki/ca.cert.pem'),
        cert: fs.readFileSync(`${dir}/client.cert.pem`), key: fs.readFileSync(`${dir}/client.key.pem`),
        headers: { Authorization: `Bearer ${record.deviceToken}` }, timeout: 8000
    }, response => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('error', () => resolve({ ok: false }));
        response.on('end', () => {
            try {
                const data = JSON.parse(body);
                const ok = response.statusCode === 200 && data.deviceId === record.deviceId && data.online;
                report.relay = { online: !!ok, adbProbeOk: data.adbProbe?.ok === true, transport: data.adbProbe?.transport ?? 'unknown' };
                resolve({ ok, relayStatus: data, message: 'Relay unavailable' });
            } catch { resolve({ ok: false }); }
        });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ ok: false }));
    request.end();
});
const fleet = createFleet({ root: process.cwd(), readDevices: () => records, readSettings: () => read('.desktop-data/settings.json'), exec, checkRelayDevice, viewer: { shutdown: async () => {}, stop: async () => {} } });
let serial, port, browser, page;
const adb = async args => {
    const result = await exec('adb', ['-s', serial, ...args], 15000);
    if (!result.ok) throw new Error('adb_failed');
    return result.stdout.trim();
};
try {
    report.stage = 'remote_adb';
    serial = await fleet.connect(record);
    report.identityMatched = await adb(['shell', 'getprop', 'ro.serialno']) === record.serial;
    if (!report.identityMatched) throw new Error('identity_mismatch');
    report.bootId = await adb(['shell', 'cat', '/proc/sys/kernel/random/boot_id']);
    report.userState = await adb(['shell', 'am', 'get-started-user-state', '0']);
    report.legacyTcpPortSet = await adb(['shell', 'getprop', 'service.adb.tcp.port']) === '5555';
    if (report.userState !== 'RUNNING_UNLOCKED') throw new Error('manual_unlock_required');
    report.stage = 'chrome_cdp';
    await adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'about:blank', 'com.android.chrome']);
    port = await adb(['forward', 'tcp:0', 'localabstract:chrome_devtools_remote']);
    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20000;
    while (true) {
        try { const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2000) }); if (response.ok) break; } catch {}
        if (Date.now() >= deadline) throw new Error('cdp_not_ready');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    page = await browser.contexts()[0].newPage();
    page.setDefaultTimeout(15000);
    await page.setContent('<html><body><p id="relay-smoke">Chrome relay smoke</p></body></html>');
    report.chromeDomVerified = await page.locator('#relay-smoke').textContent() === 'Chrome relay smoke';
    if (process.argv.includes('--reboot-after-check')) {
        report.stage = 'reboot_preflight';
        if (!report.chromeDomVerified) throw new Error('chrome_check_failed');
        const battery = await adb(['shell', 'dumpsys', 'battery']);
        report.batteryLevel = Number(battery.match(/level: (\d+)/)?.[1]);
        if (!(report.batteryLevel >= 25)) throw new Error('battery_too_low');
        await page.close(); page = undefined;
        await browser.close(); browser = undefined;
        report.rebootRequestedAt = new Date().toISOString();
        await adb(['reboot']);
        report.rebootCommandSucceeded = true;
    }
    report.stage = 'complete';
} catch {
    report.blocker = `${report.stage}_failed`;
} finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (port && serial) await exec('adb', ['-s', serial, 'forward', '--remove', `tcp:${port}`], 5000);
    if (serial) await exec('adb', ['disconnect', serial], 5000);
    await fleet.shutdown();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(`results/remote-chrome-${record.deviceId}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (!report.chromeDomVerified || report.blocker) process.exitCode = 1;
}
