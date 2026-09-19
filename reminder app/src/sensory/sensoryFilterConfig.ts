import { FilterMode, SensoryFilterConfig } from './types';

export { FilterMode, SensoryFilterConfig };

/**
 * Default blacklist packages: filters out core Android system UI, input methods,
 * downloads, and launcher noise while capturing user-facing apps.
 */
export const DEFAULT_BLACKLIST_PACKAGES: string[] = [
  'android',
  'com.android.systemui',
  'com.google.android.gms',
  'com.android.vending',
  'com.android.providers.downloads',
  'com.google.android.inputmethod.latin',
  'com.samsung.android.honeyboard',
  'com.sec.android.app.launcher',
  'com.google.android.apps.nexuslauncher',
  'com.android.settings',
  'com.google.android.deskclock',
  'com.sec.android.app.clockpackage',
];

/**
 * Recommended packages for high-precision Whitelist mode.
 */
export const RECOMMENDED_WHITELIST_PACKAGES: string[] = [
  // Food & Grocery Delivery
  'com.swiggy.android',
  'com.application.zomato',
  'com.blinkit.app',
  'com.zeptonow.android',
  'com.instamart.customer',
  'com.ubercab.eats',
  // E-Commerce & Retail
  'com.amazon.mShop.android.shopping',
  'in.amazon.mShop.android.shopping',
  'com.flipkart.android',
  'com.myntra.android',
  'com.tatacliq.app',
  // Mobility & Travel
  'com.ubercab',
  'com.olacabs.customer',
  'com.rapido.passenger',
  'in.goindigo.android',
  'com.makemytrip',
  // Utilities & Banking Alerts
  'com.phonepe.app',
  'net.one97.paytm',
  'com.google.android.apps.nbu.paisa.user',
  'com.cred.app',
];

export const DEFAULT_FILTER_CONFIG: SensoryFilterConfig = {
  mode: 'blacklist',
  packages: DEFAULT_BLACKLIST_PACKAGES,
  enableOtpQuarantine: true,
  ignoreOngoing: true,
  enabled: true,
  autoClearPromos: true,
  autoSnoozeNoise: false,
};

/**
 * Validates and sanitizes a raw config object into a valid SensoryFilterConfig.
 */
export function validateFilterConfig(raw: unknown): SensoryFilterConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_FILTER_CONFIG };
  }

  const obj = raw as Partial<SensoryFilterConfig>;
  const mode: FilterMode = obj.mode === 'whitelist' ? 'whitelist' : 'blacklist';

  let rawPackages: unknown[] = [];
  if (Array.isArray(obj.packages)) {
    rawPackages = obj.packages;
  } else if (mode === 'whitelist' && Array.isArray(obj.whitelistedPackages)) {
    rawPackages = obj.whitelistedPackages;
  } else if (mode === 'blacklist' && Array.isArray(obj.blacklistedPackages)) {
    rawPackages = obj.blacklistedPackages;
  } else {
    rawPackages = DEFAULT_BLACKLIST_PACKAGES;
  }

  const packages = rawPackages.filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );

  return {
    mode,
    packages,
    enableOtpQuarantine: obj.enableOtpQuarantine ?? true,
    ignoreOngoing: obj.ignoreOngoing ?? true,
    enabled: obj.enabled ?? true,
    autoClearPromos: obj.autoClearPromos !== undefined ? Boolean(obj.autoClearPromos) : true,
    autoSnoozeNoise: obj.autoSnoozeNoise !== undefined ? Boolean(obj.autoSnoozeNoise) : false,
  };
}

/**
 * Evaluates whether a package is permitted given the active filter config.
 */
export function isPackageAllowed(packageName: string, config: SensoryFilterConfig): boolean {
  if (config.enabled === false) {
    return false;
  }
  const target = packageName.trim().toLowerCase();
  const pkgList = (config.packages || []).map((p) => p.trim().toLowerCase());

  if (config.mode === 'whitelist') {
    return pkgList.includes(target);
  }
  return !pkgList.includes(target);
}
