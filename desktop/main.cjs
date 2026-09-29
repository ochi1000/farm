const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const simulationAction = require('./simulation.cjs')(message => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('simulation-event', message);
});
const APK_PATH = path.join(ROOT, 'android-x-runner', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const BACKGROUND_CHROME_VIEW_SCRIPT = path.join(ROOT, 'scripts', 'start-background-chrome-view.ps1');
const DEVICE_VIEW_SCRIPT = path.join(ROOT, 'scripts', 'start-device-view.ps1');
const PKI_SCRIPT = path.join(ROOT, 'scripts', 'new-relay-pki.ps1');
const X_CLI_PATH = path.join(ROOT, 'dist', 'x-automation', 'cli.js');
const RELAY_PACKAGE = 'com.ocorp.xrunner';
const USER_DATA = path.join(ROOT, '.desktop-data');
const CACHE_DATA = path.join(USER_DATA, 'cache');
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');
const PKI_PATH = path.join(USER_DATA, 'pki');
const DEVICES_PATH = path.join(USER_DATA, 'devices.json');
let sshTunnel = null;
const embeddedViewer = require('./embedded-viewer.cjs')({ root: ROOT, emit: emitViewerEvent });
const fleet = require('./fleet.cjs')({ root: ROOT, readDevices, readSettings, exec, checkRelayDevice, runAction, viewer: embeddedViewer });

fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(CACHE_DATA, { recursive: true });
app.setPath('userData', USER_DATA);
app.setPath('cache', CACHE_DATA);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 920,
    minHeight: 680,
    title: 'All in Device Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function emitViewerEvent(message) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('viewer-event', message);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
  void fleet.shutdown();
  stopSshTunnel();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('run-action', async (_event, action, options = {}) => {
  return await runAction(action, options);
});

ipcMain.handle('get-settings', async () => {
  return readSettings();
});

ipcMain.on('viewer-input', (_event, input) => {
  if (!input || typeof input.deviceId !== 'string') return;
  void fleet.input(input.deviceId, input).catch(error => {
    emitViewerEvent({ channel: 'viewer', type: 'error', deviceId: input.deviceId, message: error.message });
  });
});

async function runAction(action, options) {
  if (['simulationStart', 'simulationStop', 'simulationStatus', 'simulationReport', 'simulationHistory'].includes(action)) return simulationAction(action, options);
  const saved = readSettings();
  if (['longRunStart', 'longRunStatus', 'longRunStop'].includes(action)) {
    const runs = await import('../scripts/long-run.mjs');
    if (action === 'longRunStatus') return runs.status(String(options.runId));
    if (action === 'longRunStop') return runs.stop(String(options.runId));
    const record = readDevices().find(device => device.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    const serial = await fleet.connect(record);
    return runs.start({ serial, deviceId: record.deviceId, ...(options.smoke ? { durationSeconds: 180, maxCycles: 1 } : {}) });
  }
  if (action === 'discoverUsbDevices') {
    return await discoverUsbDevices();
  }
  if (action === 'fleetEnroll') {
    const id = await fleet.enroll(options);
    return {ok:true,title:'Device enrolled',message:'Connected to VPS. Viewing is off.',deviceId:id};
  }
  if (action === 'fleetStopAll') {
    await Promise.all(readDevices().map(record => fleet.stopView(record.deviceId)));
    return friendly(true,'Views stopped','All viewing sessions closed; relay connections remain available.');
  }
  if (action === 'fleetViewAll') {
    const outcomes = [];
    for (const record of readDevices()) {
      try { await fleet.view(record); outcomes.push(record.name + ': viewing'); }
      catch(error) { outcomes.push(record.name + ': ' + error.message); }
    }
    return friendly(true,'View all complete',outcomes.join('\n'));
  }
  if (action === 'fleetList') {
    const records = readDevices();
    const results = [];
    let enrollmentChanged = false;
    for (const record of records) {
      const status = record.deviceToken ? await checkRelayDevice({ host: record.relayHost, statusPort: record.statusPort, deviceId: record.deviceId, token: record.deviceToken }) : null;
      if (status?.relayStatus?.online && record.enrollment !== 'complete') {
        record.enrollment = 'complete';
        enrollmentChanged = true;
      }
      const relayOnline = Boolean(status?.relayStatus?.online);
      const adbReady = Boolean(relayOnline && status?.relayStatus?.adbProbe?.ok);
      const state = !status?.relayStatus ? 'Unknown' : !relayOnline ? 'Offline' : adbReady ? 'Ready' : 'Relay only';
      results.push({ ...record, deviceToken: undefined, viewing: fleet.isViewing(record.deviceId), viewMode: fleet.viewMode(record.deviceId), relayOnline, adbReady, state, message: status?.message || 'Enrollment incomplete', model: status?.relayStatus?.model || record.name });
    }
    if (enrollmentChanged) fs.writeFileSync(DEVICES_PATH, JSON.stringify(records, null, 2));
    return { ok: true, devices: results };
  }
  if (action === 'fleetRename') {
    const name = String(options.name || '').trim();
    if (!name) throw new Error('Enter a device name.');
    const records = readDevices();
    const record = records.find(device => device.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    record.name = name.slice(0, 80);
    fs.writeFileSync(DEVICES_PATH, JSON.stringify(records, null, 2));
    return { ok: true, title: 'Name saved', message: record.name, deviceId: record.deviceId };
  }
  if (action === 'fleetRemove') {
    const record = readDevices().find(device => device.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    const result = await fleet.remove(record);
    return {
      ok: true,
      title: 'Device removed',
      message: result.phoneStopped
        ? `${record.name} was disconnected and removed.`
        : `${record.name} was revoked and removed. It was not locally reachable, so the VPS will reject any reconnect attempt.`,
      deviceId: record.deviceId
    };
  }
  if (action === 'fleetSave') {
    if (!/^[a-zA-Z0-9_-]+$/.test(options.deviceId || '')) throw new Error('Enter a valid device ID.');
    const records = readDevices();
    const previous = records.find(d => d.deviceId === options.deviceId) || {};
    const record = { ...previous, deviceId: options.deviceId, name: String(options.name || options.deviceId), serial: String(options.serial || ''), wirelessTarget: String(options.wirelessTarget || ''), relayHost: String(options.host || saved.relayHost), statusPort: String(options.statusPort || '8051'), deviceToken: options.token || previous.deviceToken || '' };
    fs.writeFileSync(DEVICES_PATH, JSON.stringify([...records.filter(d => d.deviceId !== record.deviceId), record], null, 2));
    return friendly(true, 'Device saved', record.name);
  }
  if (action === 'fleetAction') {
    const record = readDevices().find(d => d.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    if (options.command === 'recoverDevice') {
      const recovery = await require('./recovery.cjs')(record, { exec, connect: fleet.connect });
      return { ...recovery, title: recovery.ok ? 'Recovery requested' : 'Recovery unavailable' };
    }
    if (options.command === 'stopView') await fleet.stopView(record.deviceId);
    else if (options.command === 'deviceView') await fleet.view(record);
    else if (options.command === 'backgroundChromeView') await fleet.view(record,true);
    else if (options.command === 'remoteAdbConnect') await fleet.connect(record);
    else if (options.command === 'openRelayApp') {
      const serial = await fleet.connect(record);
      return runAction('openRelayApp',{serial});
    } else throw new Error('Unsupported device action.');
    const actionMessages = {
      stopView: 'Viewing stopped.',
      deviceView: 'Phone view is active in the desktop app.',
      backgroundChromeView: 'Chrome view is active in the desktop app.'
    };
    return friendly(true,'Complete',actionMessages[options.command] || 'Device action completed.');
  }
  if (action === 'xBrainPlan') {
    const record = readDevices().find(device => device.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    const instruction = String(options.instruction || '').trim();
    if (!instruction || instruction.length > 4000) throw new Error('Enter an instruction of up to 4000 characters.');
    const serial = await fleet.connect(record);
    const result = await exec('node', [path.join(ROOT, 'dist', 'brain', 'cli.js'), '--serial', serial, '--device', record.deviceId, '--account', String(options.accountId || 'x-lab-account'), '--instruction', instruction], 360000);
    if (!result.ok) throw new Error('Local brain preview failed. Check Ollama and device readiness.');
    return JSON.parse(result.stdout);
  }
  if (action === 'xInstruction') {
    const record = readDevices().find(device => device.deviceId === options.deviceId);
    if (!record) throw new Error('Select a registered device.');
    const allowedActions = new Set(['read_feed','scroll_feed','follow_user','like_post','comment_post','create_post']);
    if (!allowedActions.has(options.xAction)) throw new Error('Select a valid X operation.');
    const serial = await fleet.connect(record);
    const args = [X_CLI_PATH, '--serial', serial, '--device', record.deviceId, '--account', String(options.accountId || 'x-lab-account'), '--action', options.xAction];
    if (options.username) args.push('--username', String(options.username));
    if (options.text) args.push('--text', String(options.text));
    if (options.postIndex !== undefined) args.push('--post-index', String(options.postIndex));
    if (options.postUrl) args.push('--post-url', String(options.postUrl));
    if (options.scrolls !== undefined) args.push('--scrolls', String(options.scrolls));
    if (options.limit !== undefined) args.push('--limit', String(options.limit));
    if (options.idempotencyKey) args.push('--idempotency-key', String(options.idempotencyKey));
    if (options.commit) args.push('--commit');
    if (options.closeTab) args.push('--close-tab');
    const result = await exec('node', args, 120_000, undefined, {
      X_TASK_APPROVAL_TOKEN_INPUT: String(options.approvalToken || '')
    });
    let response;
    try { response = JSON.parse(result.ok ? result.stdout : result.stderr); } catch {}
    if (!result.ok) throw new Error(response?.error || result.stderr || result.stdout || 'X operation failed.');
    const output = response?.output;
    const summary = output?.posts
      ? `${output.posts.length} visible posts returned.`
      : `Result: ${output?.actionResult?.state || 'complete'}.`;
    return { ok: true, title: options.commit ? 'X operation complete' : 'X preview complete', message: summary, output };
  }
  const serial = String(options.serial || '').trim();
  const wirelessTarget = normalizeWirelessTarget(options.wirelessTarget || saved.wirelessTarget || '');
  const host = options.host || saved.relayHost || '102.68.84.191';
  const port = String(options.port || '8050');
  const statusPort = String(options.statusPort || saved.statusPort || '8051');
  const deviceId = options.deviceId || saved.deviceId || '';
  const token = options.token || readDevices().find(d => d.deviceId === options.deviceId)?.deviceToken || (options.deviceId === saved.deviceId ? saved.deviceToken : '') || '';
  const sshUser = String(options.sshUser || saved.sshUser || '').trim();
  const sshKeyPath = String(options.sshKeyPath || saved.sshKeyPath || '').trim();
  const tunnelPort = validPort(options.tunnelPort || saved.tunnelPort || '15555');

  switch (action) {
    case 'deviceView': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      const result = await exec('powershell', ['-ExecutionPolicy', 'Bypass', '-File', DEVICE_VIEW_SCRIPT, '-Serial', selection.deviceSerial, '-Detached']);
      return friendly(result.ok, result.ok ? 'Viewer opened' : 'Viewer failed', result.ok ? selection.deviceSerial : result.stderr, result);
    }
    case 'adbStatus':
      return summarizeDevices(await exec('adb', ['devices', '-l']));
    case 'devices':
      return await exec('adb', ['devices', '-l']);
    case 'tcpip': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      return withDeviceSerial(summarizeTcpip(await exec('adb', ['-s', selection.deviceSerial, 'tcpip', '5555'])), selection.deviceSerial);
    }
    case 'wirelessStatus':
      return await checkWirelessAdb(wirelessTarget);
    case 'relayDeviceStatus':
      return await checkRelayDevice({ host, statusPort, deviceId, token });
    case 'generateMtls':
      return await generateMtls({ host, deviceId });
    case 'provisionMtls': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      return await provisionMtls(selection.deviceSerial, deviceId);
    }
    case 'secureRelayStart': {
      if (!token) return friendly(false, 'Device token required', 'Save a unique token for this device before starting its relay.');
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      const forward = await exec('adb', ['-s', selection.deviceSerial, 'forward', 'tcp:8765', 'tcp:8765']);
      if (!forward.ok) return friendly(false, 'Secure relay failed', forward.stderr || 'Could not reach All in.', forward, selection.deviceSerial);
      const result = await retryHttpGet(`http://127.0.0.1:8765/relay/start?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token)}&tls=true`);
      return friendly(result.ok, result.ok ? 'Secure relay started' : 'Secure relay failed', result.ok ? 'All in is reconnecting to the VPS with mutual TLS.' : result.stderr || result.stdout, result, selection.deviceSerial);
    }
    case 'stopRelayForDevice': {
      const deviceSummary = summarizeDevices(await exec('adb', ['devices', '-l']));
      const ready = deviceSummary.readyDeviceSerials || [];
      const target = [serial, wirelessTarget].find(candidate => candidate && ready.includes(candidate));
      if (!target) return friendly(false, 'Phone not locally reachable', 'The VPS registration will still be revoked.');
      const forward = await exec('adb', ['-s', target, 'forward', 'tcp:0', 'tcp:8765']);
      const localPort = Number.parseInt(forward.stdout.trim(), 10);
      if (!forward.ok || !Number.isInteger(localPort)) return friendly(false, 'Phone relay not stopped', forward.stderr || forward.stdout);
      try {
        const stopped = await httpGet(`http://127.0.0.1:${localPort}/relay/stop`);
        return friendly(stopped.ok, stopped.ok ? 'Phone disconnected' : 'Phone relay not stopped', stopped.stderr || stopped.stdout, stopped, target);
      } finally {
        await exec('adb', ['-s', target, 'forward', '--remove', `tcp:${localPort}`]);
      }
    }
    case 'remoteAdbConnect':
      return await connectRemoteAdb({ host, sshUser, sshKeyPath, tunnelPort, deviceId, token, statusPort });
    case 'remoteDeviceView': {
      const remoteSerial = `127.0.0.1:${tunnelPort}`;
      const connected = await ensureAdbConnected(remoteSerial);
      if (!connected.ok) return connected;
      const launch = await exec('powershell', ['-ExecutionPolicy', 'Bypass', '-File', DEVICE_VIEW_SCRIPT, '-Serial', remoteSerial, '-Detached']);
      return friendly(launch.ok, launch.ok ? 'Remote device viewer opened' : 'Remote viewer failed', launch.ok ? 'scrcpy is streaming the phone through the VPS SSH tunnel.' : launch.stderr || launch.stdout, launch, remoteSerial);
    }
    case 'backgroundChromeView': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      const launch = await exec('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', BACKGROUND_CHROME_VIEW_SCRIPT,
        '-Serial', selection.deviceSerial,
        '-Detached'
      ]);
      if (!launch.ok) {
        return friendly(false, 'Could not open Chrome viewer', launch.stderr || launch.stdout || 'The background Chrome viewer failed to start.', launch, selection.deviceSerial);
      }
      return friendly(
        true,
        'Background Chrome viewer opened',
        'Chrome is running on an isolated virtual display. The owner can use or lock the primary display.',
        launch,
        selection.deviceSerial
      );
    }
    case 'usbBootstrap': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      const selectedSerial = selection.deviceSerial;
      const install = await ensureRelayAppInstalled(selectedSerial);
      if (!install.ok) return install;
      const start = summarizeOpenRelayApp(await exec('adb', ['-s', selectedSerial, 'shell', 'am', 'start', '-n', `${RELAY_PACKAGE}/.MainActivity`]));
      if (!start.ok) return start;
      const powerExemption = await exec('adb', ['-s', selectedSerial, 'shell', 'cmd', 'deviceidle', 'whitelist', `+${RELAY_PACKAGE}`]);
      const chromePowerExemption = await exec('adb', ['-s', selectedSerial, 'shell', 'cmd', 'deviceidle', 'whitelist', '+com.android.chrome']);
      const forward = await exec('adb', ['-s', selectedSerial, 'forward', 'tcp:8765', 'tcp:8765']);
      if (!forward.ok) return friendly(false, 'Relay setup failed', forward.stderr || 'Could not reach the All in service.', forward, selectedSerial);
      const relayStatus = await retryHttpGet('http://127.0.0.1:8765/relay/status');
      if (!relayStatus.ok) return friendly(false, 'Relay setup failed', relayStatus.stderr || relayStatus.stdout || 'Could not read the phone identity.', relayStatus, selectedSerial);
      const relayResponse = parseJson(relayStatus.stdout);
      const detectedDeviceId = relayResponse?.relay?.deviceId || deviceId;
      const phoneIp = await getDeviceWifiIp(selectedSerial);
      const currentPort = await exec('adb', ['-s', selectedSerial, 'shell', 'getprop', 'service.adb.tcp.port']);
      const tcpip = currentPort.ok && currentPort.stdout.trim() === '5555'
        ? friendly(true, 'ADB TCP ready', 'ADB TCP is already enabled.')
        : summarizeTcpip(await exec('adb', ['-s', selectedSerial, 'tcpip', '5555']));
      if (!tcpip.ok) return tcpip;
      const detectedWirelessTarget = phoneIp ? `${phoneIp}:5555` : '';
      writeSettings({
        ...readSettings(),
        ...(detectedWirelessTarget ? { wirelessTarget: detectedWirelessTarget } : {}),
        relayHost: host,
        statusPort,
        deviceId: saved.deviceId,
        deviceToken: saved.deviceToken,
        sshUser,
        sshKeyPath,
        tunnelPort
      });
      const message = detectedWirelessTarget
        ? `All in is installed and ADB TCP is listening. Wireless target saved: ${detectedWirelessTarget}. Generate and provision mTLS before starting the relay.`
        : 'All in is installed and ADB TCP is listening on port 5555. Generate and provision mTLS before starting the relay.';
      return friendly(true, 'ADB setup complete', message, {
        ...tcpip,
        wirelessTarget: detectedWirelessTarget,
        deviceId: detectedDeviceId,
        powerExemptionConfigured: powerExemption.ok,
        chromePowerExemptionConfigured: chromePowerExemption.ok
      }, selectedSerial);
    }
    case 'openRelayApp': {
      const selection = await resolveConnectedSerial(serial);
      if (!selection.ok) return selection;
      return withDeviceSerial(summarizeOpenRelayApp(await exec('adb', ['-s', selection.deviceSerial, 'shell', 'am', 'start', '-n', `${RELAY_PACKAGE}/.MainActivity`])), selection.deviceSerial);
    }
    case 'install':
      return await exec('adb', ['-s', serial, 'install', '-r', APK_PATH], 60_000);
    case 'start':
      return await exec('adb', ['-s', serial, 'shell', 'am', 'start', '-n', 'com.ocorp.xrunner/.MainActivity']);
    case 'forward':
      return await exec('adb', ['-s', serial, 'forward', 'tcp:8765', 'tcp:8765']);
    case 'health':
      return await httpGet('http://127.0.0.1:8765/health');
    case 'adbProbe':
      return await httpGet('http://127.0.0.1:8765/adb-probe');
    case 'chromeOpen':
      return await httpGet('http://127.0.0.1:8765/chrome/open');
    case 'home':
      return await httpGet('http://127.0.0.1:8765/home');
    case 'relayStart':
      return await httpGet(`http://127.0.0.1:8765/relay/start?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token)}&tls=true`);
    case 'relayStatus':
      return await httpGet('http://127.0.0.1:8765/relay/status');
    case 'testBackground':
      return await exec(npmCommand(), ['run', 'test:background', '--', '--serial', serial, '--pause-ms', '1000'], 90_000);
    case 'testLocked':
      return await exec(npmCommand(), ['run', 'test:locked', '--', '--serial', serial, '--pause-ms', '1000'], 90_000);
    case 'buildRelayApp':
      return await exec(npmCommand(), ['run', 'android:build'], 120_000);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function discoverUsbDevices() {
  const result = await exec('adb', ['devices', '-l']);
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Could not scan connected phones.');

  const entries = result.stdout.split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
  const direct = entries.filter(entry => !entry.serial.includes(':') && !entry.serial.startsWith('emulator-'));
  const ready = direct.filter(entry => entry.state === 'device');
  const unauthorized = direct.filter(entry => entry.state === 'unauthorized').length;
  const offline = direct.filter(entry => entry.state === 'offline').length;

  const phones = await Promise.all(ready.map(async entry => {
    const [manufacturer, model, android] = await Promise.all([
      exec('adb', ['-s', entry.serial, 'shell', 'getprop', 'ro.product.manufacturer'], 10_000),
      exec('adb', ['-s', entry.serial, 'shell', 'getprop', 'ro.product.model'], 10_000),
      exec('adb', ['-s', entry.serial, 'shell', 'getprop', 'ro.build.version.release'], 10_000)
    ]);
    const maker = manufacturer.ok ? manufacturer.stdout.trim() : '';
    const modelName = model.ok ? model.stdout.trim() : '';
    const version = android.ok ? android.stdout.trim() : '';
    const suggestedName = [maker, modelName].filter(Boolean).join(' ') || 'Android phone';
    return {
      serial: entry.serial,
      label: version ? `${suggestedName} - Android ${version}` : suggestedName,
      suggestedName
    };
  }));

  let message = phones.length === 1 ? '1 authorized phone detected.' : `${phones.length} authorized phones detected.`;
  if (!phones.length && unauthorized) message = 'Unlock the phone and approve the USB debugging prompt.';
  else if (!phones.length && offline) message = 'The connected phone is offline. Reconnect its USB cable.';
  else if (!phones.length) message = 'Connect an Android phone by USB and enable USB debugging.';
  return { ok: phones.length > 0, phones, message };
}

async function resolveConnectedSerial(requestedSerial) {
  const result = await exec('adb', ['devices', '-l']);
  const summary = summarizeDevices(result);
  if (!summary.ok) return summary;

  const readySerials = summary.readyDeviceSerials || [];
  if (requestedSerial && readySerials.includes(requestedSerial)) {
    return friendly(true, 'Device selected', `${requestedSerial} is connected and authorized.`, result, requestedSerial);
  }
  if (requestedSerial) return friendly(false, 'Selected device unavailable', `${requestedSerial} is not connected. No other phone was selected.`);
  if (readySerials.length === 1) {
    return friendly(true, 'Device selected', `${readySerials[0]} is connected and authorized.`, result, readySerials[0]);
  }

  const usbSerials = readySerials.filter((candidate) => !candidate.includes(':'));
  if (usbSerials.length === 1) {
    return friendly(true, 'USB device selected', `${usbSerials[0]} is connected over USB.`, result, usbSerials[0]);
  }

  const requestedMessage = requestedSerial ? `The saved device ${requestedSerial} is not connected. ` : '';
  return friendly(
    false,
    'Choose a device',
    `${requestedMessage}Multiple authorized devices were found: ${readySerials.join(', ')}. Enter the serial to use.`,
    result
  );
}

async function checkRelayDevice({ host, statusPort, deviceId, token }) {
  if (!host || !deviceId || !token) {
    return friendly(false, 'Relay device not configured', 'Run ADB Setup once, or enter the VPS host, device ID, and device token.');
  }
  const caPath = path.join(PKI_PATH, 'ca.cert.pem');
  const clientDirectory = path.join(PKI_PATH, 'devices', deviceId);
  const result = await httpGet(
    `https://${host}:${statusPort}/devices/${encodeURIComponent(deviceId)}/status`,
    {
      headers: { Authorization: `Bearer ${token}` },
      caPath,
      certPath: path.join(clientDirectory, 'client.cert.pem'),
      keyPath: path.join(clientDirectory, 'client.key.pem')
    }
  );
  const status = parseJson(result.stdout);
  if (!result.ok) {
    return friendly(false, 'Relay status unavailable', result.stderr || status?.error || 'Could not reach the VPS status service.', result);
  }
  if (!status?.online) {
    const seen = status?.lastSeenAt ? new Date(status.lastSeenAt).toLocaleString() : 'not seen since this server started';
    return friendly(false, 'Device offline', `The VPS reports ${deviceId} offline. Last seen: ${seen}.`, { ...result, relayStatus: status });
  }
  const adb = status.adbProbe?.ok ? 'Local ADB is reachable.' : 'Relay is online; local ADB is not currently reachable.';
  return friendly(true, 'Device online', `${status.model || deviceId} is connected to the VPS. ${adb}`, { ...result, relayStatus: status });
}

async function generateMtls({ host, deviceId }) {
  if (!host || !deviceId) return friendly(false, 'Device identity needed', 'Enter the VPS host and device ID first.');
  const result = await exec('powershell', ['-ExecutionPolicy', 'Bypass', '-File', PKI_SCRIPT, '-ServerHost', host, '-DeviceId', deviceId], 60_000);
  return friendly(result.ok && result.stdout.includes('PKI_READY'), result.ok ? 'mTLS certificates ready' : 'Certificate generation failed', result.ok ? 'Server and per-device certificates were created under .desktop-data/pki.' : result.stderr || result.stdout, result);
}

async function provisionMtls(serial, deviceId) {
  if (!deviceId) return friendly(false, 'Device ID needed', 'Enter the device ID before provisioning certificates.');
  const forward = await exec('adb', ['-s', serial, 'forward', 'tcp:8765', 'tcp:8765']);
  if (!forward.ok) return friendly(false, 'Phone unavailable', forward.stderr);
  const identity = await httpGet('http://127.0.0.1:8765/relay/status');
  if (parseJson(identity.stdout)?.relay?.deviceId !== deviceId) return friendly(false, 'Device identity mismatch', 'The selected phone does not match this certificate identity. Run preparation to read its device ID.');
  const caPath = path.join(PKI_PATH, 'ca.cert.pem');
  const devicePkiPath = path.join(PKI_PATH, 'devices', deviceId);
  const p12Path = path.join(devicePkiPath, 'client.p12');
  const passwordPath = path.join(devicePkiPath, 'client-password.txt');
  if (!fs.existsSync(caPath) || !fs.existsSync(p12Path) || !fs.existsSync(passwordPath)) {
    return friendly(false, 'Certificates not found', 'Generate the mTLS certificates first.', null, serial);
  }

  const prepareDirectory = await exec('adb', ['-s', serial, 'shell', 'run-as', RELAY_PACKAGE, 'mkdir', '-p', 'files']);
  if (!prepareDirectory.ok) {
    return friendly(false, 'Certificate provisioning failed', prepareDirectory.stderr || prepareDirectory.stdout || 'Could not prepare secure app storage.', prepareDirectory, serial);
  }

  const files = [[caPath, 'relay-ca.crt'], [p12Path, 'relay-client.p12'], [passwordPath, 'relay-client.pass']];
  for (const [localPath, name] of files) {
    const remotePath = `/data/local/tmp/${name}`;
    const push = await exec('adb', ['-s', serial, 'push', localPath, remotePath]);
    if (!push.ok) return friendly(false, 'Certificate provisioning failed', push.stderr || push.stdout, push, serial);
    await exec('adb', ['-s', serial, 'shell', 'chmod', '644', remotePath]);
    const copy = await exec('adb', ['-s', serial, 'shell', 'run-as', RELAY_PACKAGE, 'cp', remotePath, `files/${name}`]);
    await exec('adb', ['-s', serial, 'shell', 'rm', '-f', remotePath]);
    if (!copy.ok) return friendly(false, 'Certificate provisioning failed', copy.stderr || copy.stdout || `Could not install ${name}.`, copy, serial);
    const verify = await exec('adb', ['-s', serial, 'shell', 'run-as', RELAY_PACKAGE, 'test', '-s', `files/${name}`]);
    if (!verify.ok) return friendly(false, 'Certificate provisioning failed', `The phone did not retain ${name}.`, verify, serial);
  }
  return friendly(true, 'mTLS provisioned', 'The phone now has its CA certificate and device-specific client identity.', null, serial);
}

async function connectRemoteAdb({ host, sshUser, sshKeyPath, tunnelPort, deviceId, token, statusPort }) {
  if (!validHost(host) || !validSshUser(sshUser)) {
    return friendly(false, 'SSH settings needed', 'Enter a valid VPS host and SSH username.');
  }
  if (!sshKeyPath || !fs.existsSync(sshKeyPath)) {
    return friendly(false, 'SSH key needed', 'Select or enter the private key path used to authenticate to the VPS.');
  }

  writeSettings({ ...readSettings(), relayHost: host, statusPort, deviceId, deviceToken: token, sshUser, sshKeyPath, tunnelPort: String(tunnelPort) });
  const tunnelAlive = sshTunnel && !sshTunnel.killed && sshTunnel.exitCode === null;
  if (!tunnelAlive && await canConnect('127.0.0.1', tunnelPort, 500)) {
    return friendly(false, 'Tunnel port in use', `Local port ${tunnelPort} is already owned by another process. Choose another local tunnel port.`);
  }
  if (!tunnelAlive) {
    stopSshTunnel();
    const args = [
      '-N', '-T', '-i', sshKeyPath,
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=20',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-L', `${tunnelPort}:127.0.0.1:15555`,
      `${sshUser}@${host}`
    ];
    sshTunnel = spawn('ssh', args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const errors = [];
    sshTunnel.stderr.on('data', (chunk) => errors.push(chunk));
    const opened = await waitForPort('127.0.0.1', tunnelPort, 10_000);
    if (!opened) {
      stopSshTunnel();
      return friendly(false, 'SSH tunnel failed', Buffer.concat(errors).toString('utf8').trim() || 'The VPS tunnel did not open. Verify the username, key, and SSH access.');
    }
  }
  return await ensureAdbConnected(`127.0.0.1:${tunnelPort}`);
}

async function ensureAdbConnected(target) {
  const result = await exec('adb', ['connect', target], 20_000);
  const output = `${result.stdout}\n${result.stderr}`;
  if (!result.ok || !/(connected to|already connected to)/i.test(output)) {
    return friendly(false, 'Remote ADB failed', output.trim() || `Could not connect to ${target}.`, result);
  }
  return friendly(true, 'Remote ADB connected', `${target} is connected through the authenticated SSH tunnel.`, result, target);
}

function stopSshTunnel() {
  if (sshTunnel && !sshTunnel.killed) sshTunnel.kill();
  sshTunnel = null;
}

function validHost(value) {
  return /^[A-Za-z0-9.-]+$/.test(String(value || ''));
}

function validSshUser(value) {
  return /^[A-Za-z0-9._-]+$/.test(String(value || ''));
}

function validPort(value) {
  const port = Number.parseInt(String(value), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 15555;
}

function canConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port, 500)) return true;
    await delay(250);
  }
  return false;
}

async function checkWirelessAdb(wirelessTarget) {
  if (!wirelessTarget) {
    return friendly(false, 'Wireless target needed', 'Enter the phone IP as <ip>:5555, or run ADB Setup over USB first so the app can try to detect it.');
  }

  const connect = await exec('adb', ['connect', wirelessTarget], 20_000);
  const output = `${connect.stdout}\n${connect.stderr}`;
  if (!/(connected to|already connected to)/i.test(output)) {
    return friendly(false, 'Wireless ADB failed', output.trim() || `Could not connect to ${wirelessTarget}.`, connect, wirelessTarget);
  }

  const devices = summarizeDevices(await exec('adb', ['devices', '-l']));
  if (!devices.ok) {
    return friendly(false, 'Wireless ADB unclear', `ADB connected to ${wirelessTarget}, but the device list is not ready yet. Try Check Wireless again.`, connect, wirelessTarget);
  }
  return friendly(true, 'Wireless ADB connected', `${wirelessTarget} is connected and authorized. USB can stay disconnected.`, connect, wirelessTarget);
}

async function ensureRelayAppInstalled(serial) {
  const installed = await exec('adb', ['-s', serial, 'shell', 'pm', 'path', RELAY_PACKAGE]);
  if (!fs.existsSync(APK_PATH)) {
    if (installed.ok && installed.stdout.includes(RELAY_PACKAGE)) {
      return friendly(true, 'Phone Relay installed', 'Phone Relay is already installed on the device.', installed, serial);
    }
    return friendly(false, 'APK not found', 'Build the Phone Relay APK before running setup.', installed, serial);
  }

  const install = await exec('adb', ['-s', serial, 'install', '-r', APK_PATH], 60_000);
  if (install.ok && /Success/i.test(install.stdout + install.stderr)) {
    return friendly(true, 'Phone Relay installed', 'Phone Relay was installed or updated on the device.', install, serial);
  }
  return friendly(false, 'Install failed', install.stderr || install.stdout || 'Could not install Phone Relay.', install, serial);
}

function summarizeDevices(result) {
  if (!result.ok) {
    return friendly(false, 'ADB error', result.stderr || result.stdout || 'Could not run adb devices.', result);
  }
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const devices = lines
    .slice(1)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state, line };
    });
  const ready = devices.filter((device) => device.state === 'device');
  const unauthorized = devices.filter((device) => device.state === 'unauthorized');
  const offline = devices.filter((device) => device.state === 'offline');

  if (ready.length > 0) {
    const message = ready.length === 1
      ? `${ready[0].serial} is connected and authorized.`
      : `${ready.length} authorized devices found. Using ${ready[0].serial} unless another serial is entered.`;
    return friendly(true, 'Device found', message, { ...result, readyDeviceSerials: ready.map((device) => device.serial) }, ready[0].serial);
  }
  if (unauthorized.length > 0) {
    return friendly(false, 'Device unauthorized', 'Approve the USB debugging prompt on the phone.', result, unauthorized[0].serial);
  }
  if (offline.length > 0) {
    return friendly(false, 'Device offline', 'Reconnect USB or restart ADB, then try again.', result, offline[0].serial);
  }
  return friendly(false, 'No devices found', 'Plug in the phone and enable USB debugging.', result);
}

function withDeviceSerial(result, deviceSerial) {
  return { ...result, deviceSerial };
}

function summarizeTcpip(result) {
  if (result.ok && /restarting in TCP mode port:\s*5555/i.test(result.stdout + result.stderr)) {
    return friendly(true, 'ADB TCP connected', 'ADB is listening on port 5555 for relay testing.', result);
  }
  return friendly(false, 'ADB TCP failed', result.stderr || result.stdout || 'Could not enable ADB TCP mode.', result);
}

function summarizeOpenRelayApp(result) {
  if (result.ok && /Starting: Intent|Warning: Activity not started|cmp=com\.ocorp\.xrunner/i.test(result.stdout + result.stderr)) {
    return friendly(true, 'All in opened', 'The All in app was started on the device.', result);
  }
  return friendly(false, 'Could not open app', result.stderr || result.stdout || 'ADB could not start All in.', result);
}

async function getDeviceWifiIp(serial) {
  const route = await exec('adb', ['-s', serial, 'shell', 'ip', 'route']);
  const routeText = `${route.stdout}\n${route.stderr}`;
  const routeMatch = routeText.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (route.ok && routeMatch) return routeMatch[1];

  const wlan = await exec('adb', ['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
  const wlanText = `${wlan.stdout}\n${wlan.stderr}`;
  const wlanMatch = wlanText.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//);
  return wlan.ok && wlanMatch ? wlanMatch[1] : '';
}

function normalizeWirelessTarget(value) {
  const target = String(value || '').trim();
  if (!target) return '';
  return target.includes(':') ? target : `${target}:5555`;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function readDevices() {
  if (fs.existsSync(DEVICES_PATH)) return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8').replace(/^\uFEFF/, ''));
  const settings = readSettings();
  const records = settings.deviceId ? [{ ...settings, name: 'Lab phone', serial: settings.wirelessTarget || '', relayHost: settings.relayHost, statusPort: settings.statusPort || '8051' }] : [];
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(records, null, 2));
  return records;
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function friendly(ok, title, message, raw, deviceSerial) {
  return {
    ...raw,
    ok,
    title,
    message,
    deviceSerial
  };
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function exec(command, args, timeoutMs = 30_000, input, environment = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true, env: { ...process.env, ...environment } });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: `${command} ${args.join(' ')}`,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: `${Buffer.concat(stderr).toString('utf8')}\n${error.message}`.trim(),
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        command: `${command} ${args.join(' ')}`,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        timedOut,
        durationMs: Date.now() - started
      });
    });
  });
}

async function httpGet(url, options = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const requestOptions = {
      method: 'GET',
      headers: options.headers || {},
      timeout: 10_000
    };
    if (parsed.protocol === 'https:' && options.caPath) {
      if (!fs.existsSync(options.caPath) || !fs.existsSync(options.certPath || '') || !fs.existsSync(options.keyPath || '')) {
        resolve({ ok: false, command: `GET ${url}`, stdout: '', stderr: 'Relay CA certificate not found. Generate or import the mTLS PKI first.', exitCode: null, timedOut: false, durationMs: Date.now() - started });
        return;
      }
      requestOptions.ca = fs.readFileSync(options.caPath);
      requestOptions.cert = fs.readFileSync(options.certPath);
      requestOptions.key = fs.readFileSync(options.keyPath);
    }
    const request = transport.request(parsed, requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        resolve({ ok, command: `GET ${url}`, stdout: prettyJson(body), stderr: ok ? '' : `HTTP ${response.statusCode}`, exitCode: ok ? 0 : response.statusCode, timedOut: false, durationMs: Date.now() - started });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', (error) => {
      resolve({ ok: false, command: `GET ${url}`, stdout: '', stderr: error.message || String(error), exitCode: null, timedOut: error.message === 'Request timed out', durationMs: Date.now() - started });
    });
    request.end();
  });
}

async function retryHttpGet(url) {
  let result;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    result = await httpGet(url);
    if (result.ok) return result;
    await delay(500);
  }
  return result;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
