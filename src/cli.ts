import { parseCli } from './config.js';
import { printChecks } from './logging/logger.js';
import { assertPreflight, runPreflight } from './preflight.js';
import { runBackgroundOnly, runBaselineOnly, runFullMatrix, runLockedOnly } from './runner/run-matrix.js';

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const preflight = await runPreflight(options.serial);
  printChecks(preflight.checks);
  assertPreflight(preflight.checks);

  const serial = preflight.selectedSerial;
  if (!serial) throw new Error('No selected Android device after preflight');
  console.log(`Device: ${serial} OK`);

  if (options.command === 'baseline') {
    await runBaselineOnly(serial, options.pauseMs);
  } else if (options.command === 'matrix') {
    await runFullMatrix(serial, options.pauseMs);
  } else if (options.command === 'background') {
    await runBackgroundOnly(serial, options.pauseMs);
  } else if (options.command === 'locked') {
    await runLockedOnly(serial, options.pauseMs);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
