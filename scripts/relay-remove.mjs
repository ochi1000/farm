import http from 'node:http';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 8192) throw new Error('Input too large');
}
const deviceId = JSON.parse(input).deviceId;
if (!/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId || '')) throw new Error('Invalid device ID');

const request = http.request({
  host: '127.0.0.1',
  port: 8052,
  path: `/devices/${encodeURIComponent(deviceId)}`,
  method: 'DELETE',
  timeout: 15000
}, response => {
  response.pipe(process.stdout);
  if (response.statusCode !== 200) process.exitCode = 1;
});
request.on('error', () => {
  console.error('VPS removal unavailable');
  process.exitCode = 1;
});
request.on('timeout', () => request.destroy());
request.end();
