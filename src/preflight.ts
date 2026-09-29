import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Adb } from './device/adb.js';

const execFileAsync = promisify(execFile);

export type PreflightCheck = {
  name: string;
  status: 'OK' | 'FAIL';
  detail: string;
};

async function commandVersion(name: string, args: string[], alternates: string[] = []): Promise<PreflightCheck> {
  const candidates = [name, ...alternates];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execCandidate(candidate, args);
      return { name, status: 'OK', detail: (stdout || stderr).split(/\r?\n/)[0]?.trim() || 'available' };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { name, status: 'FAIL', detail: errors.join(' | ') };
}

async function execCandidate(candidate: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)) {
    return await execFileAsync('cmd.exe', ['/d', '/s', '/c', candidate, ...args], { timeout: 10_000, windowsHide: true });
  }
  return await execFileAsync(candidate, args, { timeout: 10_000, windowsHide: true });
}

async function npmVersion(): Promise<PreflightCheck> {
  const alternates = process.platform === 'win32' ? ['npm.cmd'] : [];
  return await commandVersion('npm', ['--version'], alternates);
}

async function adbVersion(): Promise<PreflightCheck> {
  const alternates = process.platform === 'win32' ? ['adb.exe'] : [];
  return await commandVersion('adb', ['version'], alternates);
}

async function nodeVersion(): Promise<PreflightCheck> {
  const alternates = process.platform === 'win32' ? ['node.exe'] : [];
  return await commandVersion('node', ['--version'], alternates);
}

export async function runPreflight(serial?: string): Promise<{ checks: PreflightCheck[]; selectedSerial?: string }> {
  const adb = new Adb();
  const checks: PreflightCheck[] = [];
  checks.push(await nodeVersion());
  checks.push(await npmVersion());
  checks.push(await adbVersion());

  let selectedSerial: string | undefined;
  if (checks.find((check) => check.name === 'adb')?.status === 'OK') {
    try {
      const devices = await adb.getConnectedDevices();
      const ready = devices.filter((device) => device.state === 'device');
      if (serial) {
        const found = ready.find((device) => device.serial === serial);
        checks.push({
          name: 'adb devices',
          status: found ? 'OK' : 'FAIL',
          detail: found ? `selected ${serial}` : `serial ${serial} not found in ready devices`
        });
        selectedSerial = found?.serial;
      } else {
        checks.push({
          name: 'adb devices',
          status: ready.length === 1 ? 'OK' : 'FAIL',
          detail: ready.length === 1 ? `selected ${ready[0].serial}` : `expected exactly one ready device, found ${ready.length}`
        });
        selectedSerial = ready.length === 1 ? ready[0].serial : undefined;
      }

      if (selectedSerial) {
        const hasChrome = await adb.hasChrome(selectedSerial);
        checks.push({ name: 'Chrome detected', status: hasChrome ? 'OK' : 'FAIL', detail: hasChrome ? 'com.android.chrome found' : 'Chrome package not found' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ name: 'adb devices', status: 'FAIL', detail: message });
    }
  }

  return { checks, selectedSerial };
}

export function assertPreflight(checks: PreflightCheck[]): void {
  const failed = checks.filter((check) => check.status !== 'OK');
  if (failed.length > 0) {
    throw new Error(`Preflight failed: ${failed.map((check) => `${check.name}: ${check.detail}`).join('; ')}`);
  }
}
