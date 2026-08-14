import type { BrowserDeviceEmulation } from '@zclaudia/shared';

/**
 * Mobile device presets for the browser panel's device-emulation mode.
 * Dimensions are portrait CSS px; UA strings follow the Chrome DevTools
 * device-mode presets. The server applies these values verbatim.
 */
export interface BrowserDevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  userAgent: string;
}

const IOS_PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export const DEVICE_PRESETS: BrowserDevicePreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, dpr: 2, userAgent: IOS_PHONE_UA },
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', width: 393, height: 852, dpr: 3, userAgent: IOS_PHONE_UA },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_UA },
  { id: 'ipad-mini', label: 'iPad Mini', width: 768, height: 1024, dpr: 2, userAgent: IPAD_UA },
];

export const DEFAULT_PRESET_ID = 'iphone-15-pro';

export function toEmulation(preset: BrowserDevicePreset, landscape = false): BrowserDeviceEmulation {
  return {
    presetId: preset.id,
    width: landscape ? preset.height : preset.width,
    height: landscape ? preset.width : preset.height,
    dpr: preset.dpr,
    userAgent: preset.userAgent,
    mobile: true,
    hasTouch: true,
  };
}
