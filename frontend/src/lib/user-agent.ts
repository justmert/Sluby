/** A signed-in browser as a person reads it: "Chrome on macOS", "Safari on iPhone". */
export interface BrowserLabel {
  label: string;
  /** A phone or tablet, for the icon. */
  mobile: boolean;
}

// order matters: edge, opera and samsung also say Chrome, and every
// chromium and webkit browser also says Safari
const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:HeadlessChrome|Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string, boolean]> = [
  [/\biPhone\b/, 'iPhone', true],
  [/\biPad\b/, 'iPad', true],
  [/\bAndroid\b/, 'Android', true],
  [/\bCrOS\b/, 'ChromeOS', false],
  [/\bWindows\b/, 'Windows', false],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS', false],
  [/\bLinux\b/, 'Linux', false],
];

/**
 * Name the browser and system in a user agent. The full string stays
 * available to show in a tooltip; this is only the readable part. An agent
 * that is not a known browser (curl, a bot) or none at all is "Unknown
 * browser", with the system when one can be told.
 */
export function browserLabel(userAgent: string | null | undefined): BrowserLabel {
  const ua = userAgent ?? '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua));
  const mobile = system?.[2] ?? /\bMobile\b/.test(ua);
  if (!browser) {
    return { label: system ? `Unknown browser on ${system[1]}` : 'Unknown browser', mobile };
  }
  return { label: system ? `${browser} on ${system[1]}` : browser, mobile };
}
