import { spawn } from 'node:child_process';
import { config } from '../config.js';
import type { CommandResult, DeviceController, DeviceInfo, ScreenState } from './types.js';

const CHROME_PACKAGES = ['com.android.chrome', 'com.chrome.beta', 'com.chrome.dev', 'com.chrome.canary'];

export class AdbError extends Error {
  constructor(message: string, readonly result: CommandResult) {
    super(message);
  }
}

function excerpt(value: string, limit = 2_000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

export class Adb implements DeviceController {
  constructor(private readonly timeoutMs = config.adbTimeoutMs) {}

  async run(args: string[], timeoutMs = this.timeoutMs): Promise<CommandResult> {
    const started = Date.now();
    return await new Promise((resolve) => {
      const child = spawn('adb', args, { windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          command: 'adb',
          args,
          exitCode: null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: `${Buffer.concat(stderr).toString('utf8')}\n${error.message}`.trim(),
          timedOut,
          durationMs: Date.now() - started
        });
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          command: 'adb',
          args,
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          timedOut,
          durationMs: Date.now() - started
        });
      });
    });
  }

  async checked(args: string[], timeoutMs = this.timeoutMs): Promise<CommandResult> {
    const result = await this.run(args, timeoutMs);
    if (result.exitCode !== 0 || result.timedOut) {
      throw new AdbError(
        `adb ${args.join(' ')} failed${result.timedOut ? ' after timeout' : ''}: ${excerpt(result.stderr || result.stdout)}`,
        result
      );
    }
    return result;
  }

  async shell(serial: string, command: string, timeoutMs = this.timeoutMs): Promise<CommandResult> {
    return await this.checked(['-s', serial, 'shell', command], timeoutMs);
  }

  async getConnectedDevices(): Promise<DeviceInfo[]> {
    const result = await this.checked(['devices', '-l']);
    return result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [serial, state, ...pairs] = line.split(/\s+/);
        const details: Record<string, string> = {};
        for (const pair of pairs) {
          const [key, value] = pair.split(':', 2);
          if (key && value) details[key] = value;
        }
        return { serial, state, details };
      });
  }

  async getScreenState(serial: string): Promise<ScreenState> {
    const result = await this.shell(serial, 'dumpsys power');
    const text = result.stdout;
    if (/mHoldingDisplaySuspendBlocker=true|Display Power: state=ON|mWakefulness=Awake/i.test(text)) return 'on';
    if (/Display Power: state=OFF|mWakefulness=Asleep|mHoldingDisplaySuspendBlocker=false/i.test(text)) return 'off';
    return 'unknown';
  }

  async prepareChromeForBackground(serial: string): Promise<void> {
    await this.shell(serial, 'cmd deviceidle whitelist +com.android.chrome');
  }

  async wakeScreen(serial: string): Promise<void> {
    const state = await this.getScreenState(serial);
    if (state !== 'on') await this.shell(serial, 'input keyevent KEYCODE_WAKEUP');
  }

  async turnScreenOff(serial: string): Promise<void> {
    const state = await this.getScreenState(serial);
    if (state !== 'off') await this.shell(serial, 'input keyevent KEYCODE_SLEEP');
  }

  async launchChrome(serial: string): Promise<void> {
    await this.shell(serial, `am start -a android.intent.action.VIEW -d '${config.xStartUrl}' com.android.chrome`);
  }

  async backgroundChrome(serial: string): Promise<void> {
    await this.shell(serial, 'input keyevent KEYCODE_HOME');
  }

  async getForegroundPackage(serial: string): Promise<string | null> {
    const result = await this.shell(serial, 'dumpsys window windows');
    const text = result.stdout;
    const match =
      text.match(/mCurrentFocus=.*?\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/) ||
      text.match(/mFocusedApp=.*?\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/);
    return match?.[1] ?? null;
  }

  async hasChrome(serial: string): Promise<boolean> {
    for (const pkg of CHROME_PACKAGES) {
      const result = await this.run(['-s', serial, 'shell', 'pm', 'path', pkg]);
      if (result.exitCode === 0 && result.stdout.includes(pkg)) return true;
    }
    return false;
  }
}
