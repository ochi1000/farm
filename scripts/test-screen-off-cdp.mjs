import { execFile } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const serial = process.argv[2];
const cdpPort = process.argv[3] || '19333';

if (!serial) {
  console.error('Usage: node scripts/test-screen-off-cdp.mjs <adb-serial> [cdp-port]');
  process.exit(1);
}

let browser;
let screenWasTurnedOff = false;

try {
  await adb(['-s', serial, 'forward', `tcp:${cdpPort}`, 'localabstract:chrome_devtools_remote']);
  browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`), 15000, 'CDP connection timed out');
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => /^https?:/.test(candidate.url()));
  if (!page) throw new Error('No HTTP Chrome page is available for capture');

  const session = await page.context().newCDPSession(page);
  await adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP']);
  screenWasTurnedOff = true;
  await delay(2500);

  const powerState = await adb(['-s', serial, 'shell', 'dumpsys', 'power']);
  const displayState = await adb(['-s', serial, 'shell', 'dumpsys', 'display']);
  const screenOff = /mWakefulness=(?:Asleep|Dozing)|mHoldingDisplaySuspendBlocker=false/i.test(powerState)
    || /Display State=OFF|mScreenState=OFF|mActualState=OFF/i.test(displayState);
  const observation = await withTimeout(
    page.evaluate(() => ({
      title: document.title,
      url: location.href,
      textLength: document.body?.innerText?.length ?? 0
    })),
    10000,
    'DOM observation timed out while screen was off'
  );
  let outputPath = null;
  let visualFrameAvailable = false;
  let captureError = null;
  const capturePath = 'results/chrome-cdp-screen-off-test.png';
  await unlink(capturePath).catch(() => undefined);
  try {
    const capture = await withTimeout(
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false
      }),
      10000,
      'Chrome frame capture timed out while screen was off'
    );
    outputPath = capturePath;
    await writeFile(outputPath, Buffer.from(capture.data, 'base64'));
    visualFrameAvailable = true;
  } catch (error) {
    captureError = error instanceof Error ? error.message : String(error);
  }
  console.log(JSON.stringify({
    ok: screenOff && observation.textLength > 0,
    screenOff,
    domAccessible: observation.textLength > 0,
    visualFrameAvailable,
    captureError,
    outputPath,
    ...observation
  }, null, 2));
} finally {
  if (screenWasTurnedOff) {
    await adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']).catch(() => undefined);
  }
  await closeWithTimeout(browser);
  await adb(['-s', serial, 'forward', '--remove', `tcp:${cdpPort}`]).catch(() => undefined);
}

function adb(args) {
  return new Promise((resolve, reject) => {
    execFile('adb', args, { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message));
      else resolve(stdout);
    });
  });
}

async function closeWithTimeout(connectedBrowser) {
  if (!connectedBrowser) return;
  await withTimeout(connectedBrowser.close(), 3000, 'Browser disconnect timed out').catch(() => undefined);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
