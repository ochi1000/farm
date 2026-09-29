export type DeviceInfo = {
  serial: string;
  state: string;
  details: Record<string, string>;
};

export type ScreenState = 'on' | 'off' | 'unknown';

export type CommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

export interface DeviceController {
  getConnectedDevices(): Promise<DeviceInfo[]>;
  getScreenState(serial: string): Promise<ScreenState>;
  prepareChromeForBackground(serial: string): Promise<void>;
  wakeScreen(serial: string): Promise<void>;
  turnScreenOff(serial: string): Promise<void>;
  launchChrome(serial: string): Promise<void>;
  backgroundChrome(serial: string): Promise<void>;
  getForegroundPackage(serial: string): Promise<string | null>;
}
