import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.calls = [];
    window.phoneRelay = {
      getSettings: async () => ({ relayHost: 'lab.example' }),
      runAction: async (action, options) => {
        window.calls.push({ action, options });
        if (action === 'fleetList') return { devices: ['alpha', 'beta', 'gamma'].map((id, i) => ({ deviceId: id, name: 'Phone ' + id, model: 'Android', serial: id, state: ['Ready', 'Offline', 'Unknown'][i], relayOnline: i === 0, adbReady: i === 0, message: 'Device status' })) };
        if (action === 'discoverUsbDevices') return { ok: true, phones: [{ serial: 'usb-alpha', label: 'Google Pixel - Android 15', suggestedName: 'Google Pixel' }], message: '1 authorized phone detected.' };
        if (action === 'fleetEnroll') return { ok: true, title: 'Device enrolled', message: 'Connected', deviceId: 'alpha' };
        if (action === 'xBrainPlan') return { plan: { action: 'comment_post', text: 'Lovely garden.', username: '', postUrl: 'https://x.com/test/status/123', explanation: 'A relevant draft.' } };
        return { ok: true, title: 'Done', message: 'Complete' };
      }
    };
  });
  await page.goto(pathToFileURL(path.resolve('desktop/index.html')).href);
  await page.getByRole('button', { name: 'Phone beta', exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls.some(c => c.action === 'fleetViewAll' || c.action === 'fleetAction')), false);
  assert.equal(await page.locator('button[data-command="deviceView"]').isDisabled(), true);
  await page.getByRole('button', { name: 'Phone alpha', exact: true }).click();
  await page.locator('button[data-command="deviceView"]').click();
  assert.equal(await page.evaluate(() => window.calls.find(c => c.action === 'fleetAction').options.deviceId), 'alpha');
  await page.locator('#search').fill('gamma');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.locator('#search').fill('');
  for (const width of [1120, 390]) {
    await page.setViewportSize({ width, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `dist/fleet-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  assert.equal(await page.locator('#setup').evaluate(d => d.open), true);
  await page.waitForFunction(() => document.querySelector('#serial').value === 'usb-alpha');
  assert.equal(await page.getByLabel('Device name').inputValue(), 'Google Pixel');
  assert.equal(await page.getByText('Device ID', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Wireless target', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Device token', { exact: true }).count(), 0);
  await page.getByLabel('Device name').fill('Front desk phone');
  await page.screenshot({ path: 'dist/add-device-390.png', fullPage: true });
  await page.setViewportSize({ width: 1120, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'dist/add-device-1120.png', fullPage: true });
  await page.getByRole('button', { name: 'Set up device', exact: true }).click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'fleetEnroll'));
  const enrollment = await page.evaluate(() => window.calls.find(c => c.action === 'fleetEnroll').options);
  assert.deepEqual(enrollment, { name: 'Front desk phone', serial: 'usb-alpha' });
  await page.getByRole('button', { name: 'Phone alpha', exact: true }).click();
  await page.getByRole('button', { name: 'X operation', exact: true }).click();
  assert.equal(await page.locator('#xDialog').evaluate(dialog => dialog.open), true);
  await page.getByLabel('Operation').selectOption('follow_user');
  await page.getByLabel('Target username').fill('example_user');
  await page.screenshot({ path: 'dist/x-operation-1120.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 850 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'dist/x-operation-390.png', fullPage: true });
  await page.setViewportSize({ width: 1120, height: 850 });
  await page.getByRole('button', { name: 'Run preview', exact: true }).click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'xInstruction'));
  const xInstruction = await page.evaluate(() => window.calls.find(c => c.action === 'xInstruction').options);
  assert.equal(xInstruction.deviceId, 'alpha');
  assert.equal(xInstruction.xAction, 'follow_user');
  assert.equal(xInstruction.username, 'example_user');
  assert.equal(xInstruction.commit, false);
  await page.locator('#xBrainInstruction').fill('Draft a comment');
  await page.locator('#xBrainDraft').click();
  await page.waitForFunction(() => document.querySelector('#xText').value === 'Lovely garden.');
  assert.equal(await page.locator('#xCommit').isChecked(), false);
  await page.getByRole('button', { name: 'Run preview', exact: true }).click();
  await page.waitForFunction(() => window.calls.filter(c => c.action === 'xInstruction').length === 2);
  const brainInstruction = await page.evaluate(() => window.calls.filter(c => c.action === 'xInstruction')[1].options);
  assert.equal(brainInstruction.postUrl, 'https://x.com/test/status/123');
  assert.equal(brainInstruction.commit, false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit device', exact: true }).click();
  assert.equal(await page.locator('#connectedGroup').isHidden(), true);
  await page.getByLabel('Device name').fill('Renamed phone');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'fleetRename'));
  const rename = await page.evaluate(() => window.calls.find(c => c.action === 'fleetRename').options);
  assert.deepEqual(rename, { deviceId: 'alpha', name: 'Renamed phone' });
  await page.getByRole('button', { name: 'Phone beta', exact: true }).click();
  await page.getByRole('button', { name: 'Remove device', exact: true }).click();
  assert.equal(await page.locator('#removeDialog').evaluate(dialog => dialog.open), true);
  await page.screenshot({ path: 'dist/remove-device-1120.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'fleetRemove'));
  assert.deepEqual(await page.evaluate(() => window.calls.find(c => c.action === 'fleetRemove').options), { deviceId: 'beta' });
  await page.locator('#viewAll').click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'fleetViewAll'));
  await page.locator('#stopAll').click();
  await page.waitForFunction(() => window.calls.some(c => c.action === 'fleetStopAll'));
  console.log('PASS: selection routing, X preview, setup dialog, desktop/mobile overflow');
} finally { await browser.close(); }
