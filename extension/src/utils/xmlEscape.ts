/**
 * XML Entity Escaping Utility
 * Escapes XML special characters for Chromium Omnibox suggestion markup (<match>, <dim>, <url>).
 * Crucially replaces '&' first to prevent double-escaping downstream entities.
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
