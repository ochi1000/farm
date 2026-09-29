import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';

const deviceId = process.env.TEST_DEVICE_ID;
const token = process.env.TEST_DEVICE_TOKEN;
const pki = process.env.TEST_PKI_PATH || path.resolve('.desktop-data', 'pki');
const relayPort = Number(process.env.TEST_RELAY_PORT || 18050);
const statusPort = Number(process.env.TEST_STATUS_PORT || 18051);
if (!deviceId || !token) throw new Error('TEST_DEVICE_ID and TEST_DEVICE_TOKEN are required');

const ca = fs.readFileSync(path.join(pki, 'ca.cert.pem'));
const cert = fs.readFileSync(path.join(pki, 'devices', deviceId, 'client.cert.pem'));
const key = fs.readFileSync(path.join(pki, 'devices', deviceId, 'client.key.pem'));

await new Promise((resolve, reject) => {
  const socket = tls.connect({ host: '127.0.0.1', port: relayPort, servername: '102.68.84.191', ca, cert, key }, () => {
    const payload = Buffer.from(JSON.stringify({ deviceId, token, manufacturer: 'Test', model: 'mTLS', sdk: 36 }));
    const header = Buffer.alloc(8);
    header.writeInt32BE(1, 0);
    header.writeInt32BE(payload.length, 4);
    socket.write(Buffer.concat([header, payload]));
    setTimeout(() => socket.end(resolve), 250);
  });
  socket.once('error', reject);
});

const status = await new Promise((resolve, reject) => {
  const request = https.request({
    host: '127.0.0.1',
    port: statusPort,
    path: `/devices/${encodeURIComponent(deviceId)}/status`,
    method: 'GET',
    servername: '102.68.84.191',
    ca,
    cert,
    key,
    headers: { Authorization: `Bearer ${token}` }
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({ code: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
  });
  request.once('error', reject);
  request.end();
});

if (status.code !== 200 || status.body.deviceId !== deviceId) throw new Error(`Unexpected status response: ${JSON.stringify(status)}`);
console.log(JSON.stringify({ ok: true, mutualTls: true, statusHttps: true, deviceId }));
