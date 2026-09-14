import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Extension Multi-Target Build Artifacts', () => {
  const distDir = resolve(__dirname, '../dist');
  const chromeDir = resolve(distDir, 'chrome');
  const firefoxDir = resolve(distDir, 'firefox');

  describe('Chromium Build Target (dist/chrome)', () => {
    it('dist/chrome/manifest.json exists and conforms to Chrome MV3', () => {
      const manifestPath = resolve(chromeDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe('Remy');
      expect(manifest.background.service_worker).toBe('background.js');
      expect(manifest.side_panel).toBeDefined();
      expect(manifest.permissions).toContain('sidePanel');
      expect(manifest.commands['toggle-hud'].suggested_key.default).toBe('Ctrl+Shift+K');
      expect(manifest.commands['toggle-hud'].global).toBe(true);
    });

    it('dist/chrome/background.js exists as background bundle', () => {
      const bgPath = resolve(chromeDir, 'background.js');
      expect(existsSync(bgPath)).toBe(true);
      const content = readFileSync(bgPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('dist/chrome/content.js exists as an IIFE without import statements', () => {
      const contentPath = resolve(chromeDir, 'content.js');
      expect(existsSync(contentPath)).toBe(true);
      const content = readFileSync(contentPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toMatch(/\bimport\s+[^;]+from\s+/);
      expect(content).not.toMatch(/\bimport\s*\(/);
      expect(content).not.toMatch(/\bimport\s+['"`][^'"`]+['"`]/);
    });

    it('dist/chrome/sidepanel.html, popup.html, options.html exist', () => {
      for (const file of ['sidepanel.html', 'popup.html', 'options.html']) {
        const nested = resolve(chromeDir, 'src', file.replace('.html', ''), file);
        const root = resolve(chromeDir, file);
        expect(existsSync(nested) || existsSync(root)).toBe(true);
      }
    });

    it('dist/chrome/icons contains all required PNG icons', () => {
      for (const size of [16, 32, 48, 128]) {
        const iconPath = resolve(chromeDir, 'icons/icon-' + size + '.png');
        expect(existsSync(iconPath)).toBe(true);
        const header = readFileSync(iconPath).subarray(0, 8);
        expect(header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      }
    });
  });

  describe('Gecko Firefox & Zen Build Target (dist/firefox)', () => {
    it('dist/firefox/manifest.json exists and conforms to Gecko MV3', () => {
      const manifestPath = resolve(firefoxDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe('Remy');
      expect(manifest.background.scripts).toEqual(['background.js']);
      expect(manifest.background.service_worker).toBeUndefined();
      expect(manifest.sidebar_action).toBeDefined();
      expect(manifest.sidebar_action.default_panel).toBe('src/sidepanel/sidepanel.html');
      expect(manifest.browser_specific_settings.gecko.id).toBe('remy@prospective-memory.internal');
      expect(manifest.permissions).not.toContain('sidePanel');
      expect(manifest.commands['toggle-hud'].suggested_key.default).toBe('Alt+Shift+K');
      expect(manifest.commands['toggle-hud'].global).toBeUndefined();
    });

    it('dist/firefox/background.js exists as background event page bundle', () => {
      const bgPath = resolve(firefoxDir, 'background.js');
      expect(existsSync(bgPath)).toBe(true);
      const content = readFileSync(bgPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('dist/firefox/content.js exists as an IIFE without import statements', () => {
      const contentPath = resolve(firefoxDir, 'content.js');
      expect(existsSync(contentPath)).toBe(true);
      const content = readFileSync(contentPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toMatch(/\bimport\s+[^;]+from\s+/);
      expect(content).not.toMatch(/\bimport\s*\(/);
      expect(content).not.toMatch(/\bimport\s+['"`][^'"`]+['"`]/);
    });

    it('dist/firefox/sidepanel.html, popup.html, options.html exist', () => {
      for (const file of ['sidepanel.html', 'popup.html', 'options.html']) {
        const nested = resolve(firefoxDir, 'src', file.replace('.html', ''), file);
        const root = resolve(firefoxDir, file);
        expect(existsSync(nested) || existsSync(root)).toBe(true);
      }
    });

    it('dist/firefox/icons contains all required PNG icons', () => {
      for (const size of [16, 32, 48, 128]) {
        const iconPath = resolve(firefoxDir, 'icons/icon-' + size + '.png');
        expect(existsSync(iconPath)).toBe(true);
        const header = readFileSync(iconPath).subarray(0, 8);
        expect(header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      }
    });
  });
});
