import type { DeviceController } from './types.js';

export async function describePhoneState(device: DeviceController, serial: string): Promise<{ screen: string; chrome: string }> {
  const [screen, foregroundPackage] = await Promise.all([
    device.getScreenState(serial).catch(() => 'unknown' as const),
    device.getForegroundPackage(serial).catch(() => null)
  ]);

  return {
    screen,
    chrome: foregroundPackage === 'com.android.chrome' ? 'foreground' : foregroundPackage ? 'background' : 'unknown'
  };
}

