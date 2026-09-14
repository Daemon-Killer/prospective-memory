import { describe, it, expect } from 'vitest';
import { sanitizeTrackers } from '../src/utils/urlSanitizer';

describe('URL Tracker Sanitizer (R3 Ingress)', () => {
  it('strips standard UTM tracking parameters', () => {
    const raw = 'https://example.com/article?utm_source=twitter&utm_medium=social&utm_campaign=launch';
    const sanitized = sanitizeTrackers(raw);
    expect(sanitized).toBe('https://example.com/article');
  });

  it('strips advertising click IDs (fbclid, gclid, msclkid, mc_eid)', () => {
    const raw = 'https://store.example.com/item?fbclid=IwAR123&gclid=Cj0KCQ&msclkid=abc789&mc_eid=xyz456';
    const sanitized = sanitizeTrackers(raw);
    expect(sanitized).toBe('https://store.example.com/item');
  });

  it('strips trackers while preserving legitimate query parameters', () => {
    const raw = 'https://news.ycombinator.com/item?id=345678&utm_source=feed&page=2';
    const sanitized = sanitizeTrackers(raw);
    expect(sanitized).toBe('https://news.ycombinator.com/item?id=345678&page=2');
  });

  it('preserves URL hash fragments alongside query parameters', () => {
    const raw = 'https://docs.example.com/guide?id=42&utm_medium=email#installation-step';
    const sanitized = sanitizeTrackers(raw);
    expect(sanitized).toBe('https://docs.example.com/guide?id=42#installation-step');
  });

  it('handles case-insensitive tracker parameters', () => {
    const raw = 'https://example.com/search?q=test&UTM_SOURCE=google&FbClId=9999';
    const sanitized = sanitizeTrackers(raw);
    expect(sanitized).toBe('https://example.com/search?q=test');
  });

  it('handles edge case: empty or non-string input', () => {
    expect(sanitizeTrackers('')).toBe('');
    // @ts-expect-error test non-string
    expect(sanitizeTrackers(null)).toBe('');
    // @ts-expect-error test undefined
    expect(sanitizeTrackers(undefined)).toBe('');
  });

  it('handles edge case: non-URL text gracefully', () => {
    expect(sanitizeTrackers('simple note text')).toBe('simple note text');
  });

  it('preserves ports, protocols, and search parameters without trackers', () => {
    const raw = 'http://localhost:3000/dashboard?tab=analytics&user=admin';
    expect(sanitizeTrackers(raw)).toBe('http://localhost:3000/dashboard?tab=analytics&user=admin');
  });
});
