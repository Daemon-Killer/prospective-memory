export const REMY_CLOUD_URL = 'https://prospective-memory-api.onrender.com/agent';

/** A link can carry only a setup credential, never a destination or permissions. */
export function parseAgentPairingLink(raw: string): string | null {
  if (raw.length > 2048) return null;
  const text = raw.trim();
  const match = text.match(/^remy:\/\/pair\/?\?key=(rpl_[A-Za-z0-9_-]{43})$/)
    || text.match(/^https:\/\/prospective-memory-api\.onrender\.com\/agent\/connect#key=(rpl_[A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}
