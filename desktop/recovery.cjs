// Recover only a configured, already-authorized device. Never scan the network.
module.exports = async function recover(record, { exec, connect }) {
  try { await connect(record); return { ok: true, message: 'Remote ADB connection is ready.' }; } catch {}
  const devices = await exec('adb', ['devices'], 10000);
  const online = new Set(devices.stdout.split(/\r?\n/).filter(line => /\sdevice$/.test(line.trim())).map(line => line.trim().split(/\s+/)[0]));
  const candidates = [record.serial, record.wirelessTarget].filter(Boolean);
  for (const serial of [...new Set(candidates)]) {
    if (!online.has(serial)) {
      if (serial !== record.wirelessTarget || !/^[a-zA-Z0-9.-]+:\d+$/.test(serial)) continue;
      const result = await exec('adb', ['connect', serial], 10000);
      if (!result.ok) continue;
    }
    const identity = await exec('adb', ['-s', serial, 'shell', 'getprop', 'ro.serialno'], 10000);
    if (!identity.ok || identity.stdout.trim() !== record.serial) continue;
    if (serial === record.serial && !serial.includes(':')) {
      const tcp = await exec('adb', ['-s', serial, 'shell', 'getprop', 'service.adb.tcp.port'], 10000);
      if (tcp.stdout.trim() !== '5555') {
        const enabled = await exec('adb', ['-s', serial, 'tcpip', '5555'], 10000);
        if (!enabled.ok) return { ok: false, message: 'Connected phone was identified, but enabling relay ADB failed.' };
        const ready = await exec('adb', ['-s', serial, 'wait-for-device'], 15000);
        if (!ready.ok) return { ok: false, message: 'ADB restarted; wait for the USB connection and retry recovery.' };
      }
    }
    const exemption = await exec('adb', ['-s', serial, 'shell', 'cmd', 'deviceidle', 'whitelist', '+com.ocorp.xrunner'], 10000);
    const launched = await exec('adb', ['-s', serial, 'shell', 'am', 'start', '-n', 'com.ocorp.xrunner/.MainActivity'], 10000);
    if (!launched.ok || /Error|Exception/.test(launched.stdout + launched.stderr)) continue;
    // Activity launch starts the existing foreground service without a force-stop.
    return { ok: true, message: `All in started through authorized ADB. Refresh relay status shortly.${exemption.ok ? '' : ' Battery exemption could not be restored.'}` };
  }
  return { ok: false, message: 'No authorized route to the phone is reachable. Automatic reconnection requires phone power, internet, and its supervisor running; the controller cannot wake it over a disconnected relay.' };
};
