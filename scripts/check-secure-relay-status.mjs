import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, '.desktop-data', 'settings.json'), 'utf8').replace(/^\uFEFF/, ''));
const requestedDeviceId = process.argv[2];
const devicesPath = path.join(root, '.desktop-data', 'devices.json');
const devices = fs.existsSync(devicesPath)
  ? JSON.parse(fs.readFileSync(devicesPath, 'utf8').replace(/^\uFEFF/, ''))
  : [];
const device = requestedDeviceId
  ? devices.find((record) => record.deviceId === requestedDeviceId)
  : devices.find((record) => record.deviceId === settings.deviceId);
if (requestedDeviceId && !device) throw new Error(`Unknown device ID: ${requestedDeviceId}`);
const selected = device || settings;
const deviceDirectory = path.join(root, '.desktop-data', 'pki', 'devices', selected.deviceId);
const request = https.request({
  host: selected.relayHost || settings.relayHost || '102.68.84.191',
  port: Number(selected.statusPort || settings.statusPort || 8051),
  path: `/devices/${encodeURIComponent(selected.deviceId)}/status`,
  method: 'GET',
  ca: fs.readFileSync(path.join(root, '.desktop-data', 'pki', 'ca.cert.pem')),
  cert: fs.readFileSync(path.join(deviceDirectory, 'client.cert.pem')),
  key: fs.readFileSync(path.join(deviceDirectory, 'client.key.pem')),
  headers: { Authorization: `Bearer ${selected.deviceToken}` },
  timeout: 10_000
}, (response) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (response.statusCode !== 200 || !body.online) {
      console.error(JSON.stringify({ ok: false, statusCode: response.statusCode, body }));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      transport: 'mTLS',
      deviceId: body.deviceId,
      online: body.online,
      model: body.model,
      adbProbe: body.adbProbe
    }));
  });
});

request.on('timeout', () => request.destroy(new Error('Request timed out')));
request.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
request.end();
