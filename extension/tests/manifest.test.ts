import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Manifest V3 Specification', () => {
  const manifestPath = resolve(__dirname, '../manifest.json');

  it('manifest.json file exists and is valid JSON', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const content = readFileSync(manifestPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  it('declares manifest_version 3, name Remy, and version 1.0.0', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Remy');
    expect(manifest.version).toBe('1.0.0');
  });

  it('declares omnibox keyword "r"', () => {
    expect(manifest.omnibox).toBeDefined();
    expect(manifest.omnibox.keyword).toBe('r');
  });

  it('declares side_panel pointing to src/sidepanel/sidepanel.html', () => {
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBe('src/sidepanel/sidepanel.html');
  });

  it('declares action with default_popup and icons', () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe('src/popup/popup.html');
    expect(manifest.action.default_title).toBe('Remy Capture');
    expect(manifest.action.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });
  });

  it('declares commands with toggle-hud shortcut', () => {
    expect(manifest.commands).toBeDefined();
    expect(manifest.commands['toggle-hud']).toBeDefined();
    const cmd = manifest.commands['toggle-hud'];
    expect(cmd.suggested_key.default).toBe('Ctrl+Shift+K');
    expect(cmd.suggested_key.mac).toBe('Command+Shift+K');
    expect(cmd.global).toBe(true);
  });

  it('requests all mandatory permissions', () => {
    const requiredPermissions = [
      'storage',
      'alarms',
      'notifications',
      'contextMenus',
      'commands',
      'activeTab',
      'scripting',
      'sidePanel',
      'unlimitedStorage',
    ];
    for (const perm of requiredPermissions) {
      expect(manifest.permissions).toContain(perm);
    }
  });

  it('declares host permissions for Render prospective memory API', () => {
    expect(manifest.host_permissions).toContain('https://prospective-memory-api.onrender.com/*');
  });

  it('declares background service worker as ES module', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.background.type).toBe('module');
  });

  it('declares content script matching all urls running at document_idle', () => {
    expect(manifest.content_scripts).toBeInstanceOf(Array);
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
    const cs = manifest.content_scripts[0];
    expect(cs.matches).toContain('<all_urls>');
    expect(cs.js).toContain('content.js');
    expect(cs.run_at).toBe('document_idle');
  });

  it('declares options UI in tab', () => {
    expect(manifest.options_ui).toBeDefined();
    expect(manifest.options_ui.page).toBe('src/options/options.html');
    expect(manifest.options_ui.open_in_tab).toBe(true);
  });
});
