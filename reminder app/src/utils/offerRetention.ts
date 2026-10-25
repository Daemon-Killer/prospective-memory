export const OFFER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function offerRemovalTime(voucher: { createdAt: string; expiryDate?: string | null }): number {
  const created = Date.parse(voucher.createdAt);
  const retention = Number.isFinite(created) ? created + OFFER_RETENTION_MS : Infinity;
  const expiry = voucher.expiryDate ? Date.parse(voucher.expiryDate) : NaN;
  return Math.min(retention, Number.isFinite(expiry) ? expiry : Infinity);
}

export function hasOfferExpired(voucher: { createdAt: string; expiryDate?: string | null }, now = new Date()): boolean {
  return now.getTime() >= offerRemovalTime(voucher);
}
