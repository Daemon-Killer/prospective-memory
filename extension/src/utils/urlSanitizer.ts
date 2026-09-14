/**
 * URL Tracker Sanitizer Utility
 * Strips tracking parameters (utm_*, fbclid, gclid, msclkid, mc_eid)
 * while preserving legitimate query parameters and hash fragments.
 */
export function sanitizeTrackers(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl);
    const toDelete: string[] = [];

    for (const key of url.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith('utm_') ||
        lower === 'fbclid' ||
        lower === 'gclid' ||
        lower === 'msclkid' ||
        lower === 'mc_eid'
      ) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      url.searchParams.delete(key);
    }

    return url.toString();
  } catch {
    // If URL parsing fails, return rawUrl unchanged
    return rawUrl;
  }
}
