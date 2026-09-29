import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';

const serialIndex = process.argv.indexOf('--serial');
const nameIndex = process.argv.indexOf('--name');
const serial = serialIndex >= 0 ? process.argv[serialIndex + 1] : '';
const name = nameIndex >= 0 ? process.argv[nameIndex + 1] : '';
if (!serial || !name) throw new Error('Usage: node scripts/test-device-enrollment-live.mjs --serial <usb-serial> --name <friendly-name>');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['desktop/main.cjs'], env });
try {
  const page = await app.firstWindow();
  const enrollment = await page.evaluate(options => window.phoneRelay.runAction('fleetEnroll', options), { serial, name });
  assert.equal(enrollment.ok, true);
  const fleet = await page.evaluate(() => window.phoneRelay.runAction('fleetList'));
  const device = fleet.devices.find(candidate => candidate.deviceId === enrollment.deviceId);
  assert.ok(device, 'Enrolled phone was not saved in the inventory.');
  assert.equal(device.state, 'Online');
  console.log(`PASS: ${device.name} enrolled as ${device.deviceId} and connected over mTLS`);
} finally {
  await app.close();
}
