import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import createController from '../desktop/simulation.cjs';
import { latest } from './simulation.mjs';
assert.ok(!latest() || ['completed', 'stopped', 'failed', 'interrupted'].includes(latest().state), 'Stop the active simulation before running UI tests.');

const browser = await chromium.launch({ headless: true });
let page;
const controller = createController(message => { if (page && !page.isClosed()) void page.evaluate(value => window.simulationListener?.(value), message).catch(() => {}); }, { brainMode: 'deterministic' });
async function open() {
  page = await browser.newPage();
  await page.exposeFunction('simulationAction', (action, options) => controller(action, options));
  await page.addInitScript(() => {
    window.phoneRelay = {
      runAction: (action, options) => action.startsWith('simulation') ? window.simulationAction(action, options) : Promise.resolve({ devices: [] }),
      getSettings: async () => ({}),
      onSimulationEvent: listener => { window.simulationListener = listener; }
    };
  });
  await page.goto(pathToFileURL(path.resolve('desktop/index.html')).href);
}
try {
  await open();
  await page.locator('#simulationStart').click();
  await page.waitForFunction(() => document.querySelector('#simulationEvents').textContent.includes('action_started'));
  await page.close();
  await open();
  await page.waitForFunction(() => !document.querySelector('#simulationStop').disabled);
  await page.locator('#simulationStop').click();
  await page.waitForFunction(() => document.querySelector('#simulationState').textContent.startsWith('stopped'));
  await page.locator('#simulationReport').click();
  await page.waitForFunction(() => document.querySelector('#simulationReportText').textContent.includes('"liveSubmissions": 0'));
  assert.ok(await page.locator('#simulationStart').isEnabled());
  await page.locator('#simulationFault').check();
  await page.locator('#simulationStart').click();
  await page.waitForFunction(() => document.querySelector('#simulationState').textContent.startsWith('failed'));
  assert.match(await page.locator('#simulationError').textContent(), /Injected action failure/);
  assert.ok(await page.locator('#simulationStop').isDisabled());
  await page.locator('#simulationRefreshHistory').click();
  await page.waitForFunction(() => document.querySelector('#simulationHistory').options.length > 0);
  await page.locator('#simulationLoadHistory').click();
  await page.waitForFunction(() => document.querySelector('#simulationReportText').textContent.includes('Injected action failure'));
  console.log('PASS: actual detached worker, streamed UI events, reopen, stop, report, error banner');
} finally { await controller('dispose'); await browser.close(); }
