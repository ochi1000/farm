import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type AppConfig = {
  adbTimeoutMs: number;
  browserTimeoutMs: number;
  chromeScreenOffLaunchDelayMs: number;
  xReadyTimeoutMs: number;
  visibleTextLimit: number;
  xStartUrl: string;
};

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

loadDotEnv();

export const config: AppConfig = {
  adbTimeoutMs: intEnv('ADB_TIMEOUT_MS', 15_000),
  browserTimeoutMs: intEnv('BROWSER_TIMEOUT_MS', 20_000),
  chromeScreenOffLaunchDelayMs: intEnv('CHROME_SCREEN_OFF_LAUNCH_DELAY_MS', 8_000),
  xReadyTimeoutMs: intEnv('X_READY_TIMEOUT_MS', 45_000),
  visibleTextLimit: intEnv('VISIBLE_TEXT_LIMIT', 1_200),
  xStartUrl: process.env.X_START_URL || 'https://x.com/home'
};

export type CliOptions = {
  command: 'preflight' | 'baseline' | 'matrix' | 'background' | 'locked';
  serial?: string;
  pauseMs: number;
};

export function parseCli(argv: string[]): CliOptions {
  const [commandRaw, ...rest] = argv;
  const command = commandRaw as CliOptions['command'] | undefined;
  if (!command || !['preflight', 'baseline', 'matrix', 'background', 'locked'].includes(command)) {
    throw new Error('Usage: npm run preflight | npm run test:baseline | npm run test:matrix | npm run test:background | npm run test:locked -- [--serial <adb-serial>] [--pause-ms <ms>]');
  }

  const options: CliOptions = { command, pauseMs: 1_500 };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--serial') {
      const serial = rest[++i];
      if (!serial) throw new Error('--serial requires a value');
      options.serial = serial;
    } else if (arg === '--pause-ms') {
      const value = Number.parseInt(rest[++i] ?? '', 10);
      if (!Number.isFinite(value) || value < 0) throw new Error('--pause-ms requires a non-negative integer');
      options.pauseMs = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}
