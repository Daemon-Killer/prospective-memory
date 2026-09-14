import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Gecko / Firefox & Zen Manifest V3 Specification', () => {
  const manifestPath = resolve(__dirname, '../manifest.firefox.json');

  it('manifest.firefox.json file exists and is valid JSON', () => {
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

  it('declares mandatory browser_specific_settings.gecko with extension ID', () => {
    expect(manifest.browser_specific_settings).toBeDefined();
    expect(manifest.browser_specific_settings.gecko).toBeDefined();
    expect(manifest.browser_specific_settings.gecko.id).toBe('remy@prospective-memory.internal');
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe('115.0');
  });

  it('declares sidebar_action pointing to src/sidepanel/sidepanel.html for Zen and Firefox', () => {
    expect(manifest.sidebar_action).toBeDefined();
    expect(manifest.sidebar_action.default_panel).toBe('src/sidepanel/sidepanel.html');
    expect(manifest.sidebar_action.default_title).toBe('Remy Agenda');
    expect(manifest.sidebar_action.default_icon).toBe('icons/icon-32.png');
    // Ensure Chromium-specific side_panel field is NOT present
    expect(manifest.side_panel).toBeUndefined();
  });

  it('omits sidePanel permission which is invalid in Gecko', () => {
    expect(manifest.permissions).not.toContain('sidePanel');
  });

  it('requests valid Gecko permissions and omits commands from permissions', () => {
    const requiredPermissions = [
      'storage',
      'alarms',
      'notifications',
      'contextMenus',
      'activeTab',
      'scripting',
      'unlimitedStorage',
    ];
    for (const perm of requiredPermissions) {
      expect(manifest.permissions).toContain(perm);
    }
    expect(manifest.permissions).not.toContain('commands');
  });

  it('declares background scripts array as ES module for Gecko event page', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.scripts).toEqual(['background.js']);
    expect(manifest.background.type).toBe('module');
    // Ensure Chromium-specific service_worker field is NOT present
    expect(manifest.background.service_worker).toBeUndefined();
  });

  it('declares commands with Alt+Shift+K to avoid Firefox console conflict and omits global flag', () => {
    expect(manifest.commands).toBeDefined();
    expect(manifest.commands['toggle-hud']).toBeDefined();
    const cmd = manifest.commands['toggle-hud'];
    expect(cmd.suggested_key.default).toBe('Alt+Shift+K');
    expect(cmd.suggested_key.mac).toBe('Alt+Shift+K');
    // Gecko does not support global: true in commands
    expect(cmd.global).toBeUndefined();
  });

  it('declares omnibox keyword "r"', () => {
    expect(manifest.omnibox).toBeDefined();
    expect(manifest.omnibox.keyword).toBe('r');
  });

  it('declares host permissions for Render prospective memory API', () => {
    expect(manifest.host_permissions).toContain('https://prospective-memory-api.onrender.com/*');
  });

  it('declares action with default_popup and icons', () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe('src/popup/popup.html');
    expect(manifest.action.default_title).toBe('Remy Capture');
  });
});
