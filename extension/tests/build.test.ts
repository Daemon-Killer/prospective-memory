import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Extension Build Artifacts', () => {
  const distDir = resolve(__dirname, '../dist');

  it('dist/manifest.json exists and is valid Manifest V3', () => {
    const manifestPath = resolve(distDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Remy');
  });

  it('dist/background.js exists as background service worker bundle', () => {
    const bgPath = resolve(distDir, 'background.js');
    expect(existsSync(bgPath)).toBe(true);
    const content = readFileSync(bgPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('dist/content.js exists as an IIFE without import statements', () => {
    const contentPath = resolve(distDir, 'content.js');
    expect(existsSync(contentPath)).toBe(true);
    const content = readFileSync(contentPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).not.toMatch(/\bimport\s+[^;]+from\s+/);
    expect(content).not.toMatch(/\bimport\s*\(/);
    expect(content).not.toMatch(/\bimport\s+['"`][^'"`]+['"`]/);
  });

  it('dist/sidepanel.html exists and is accessible', () => {
    const sidepanelPath = resolve(distDir, 'src/sidepanel/sidepanel.html');
    const fallbackPath = resolve(distDir, 'sidepanel.html');
    const exists = existsSync(sidepanelPath) || existsSync(fallbackPath);
    expect(exists).toBe(true);
  });

  it('dist/popup.html exists and is accessible', () => {
    const popupPath = resolve(distDir, 'src/popup/popup.html');
    const fallbackPath = resolve(distDir, 'popup.html');
    const exists = existsSync(popupPath) || existsSync(fallbackPath);
    expect(exists).toBe(true);
  });

  it('dist/options.html exists and is accessible', () => {
    const optionsPath = resolve(distDir, 'src/options/options.html');
    const fallbackPath = resolve(distDir, 'options.html');
    const exists = existsSync(optionsPath) || existsSync(fallbackPath);
    expect(exists).toBe(true);
  });

  it('dist/icons contains all required PNG icons', () => {
    const sizes = [16, 32, 48, 128];
    for (const size of sizes) {
      const iconPath = resolve(distDir, 'icons/icon-' + size + '.png');
      expect(existsSync(iconPath)).toBe(true);
      const header = readFileSync(iconPath).subarray(0, 8);
      expect(header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    }
  });
});
