import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createZipArchive, packageAll } from '../scripts/package.js';

describe('Browser Extension Release Packaging Suite', () => {
  const distDir = resolve(__dirname, '../dist');
  const chromeZip = resolve(distDir, 'remy-chrome.zip');
  const firefoxZip = resolve(distDir, 'remy-firefox.zip');

  it('generates dist/remy-chrome.zip and dist/remy-firefox.zip via packageAll', () => {
    const res = packageAll();
    expect(res.chrome).toBeDefined();
    expect(res.firefox).toBeDefined();
    expect(existsSync(chromeZip)).toBe(true);
    expect(existsSync(firefoxZip)).toBe(true);
  });

  it('dist/remy-chrome.zip is a valid ZIP archive with standard PK zip signature', () => {
    expect(existsSync(chromeZip)).toBe(true);
    const buffer = readFileSync(chromeZip);
    expect(buffer.length).toBeGreaterThan(1000);
    // Standard ZIP local file header signature: 0x04034b50 -> 'PK\x03\x04'
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });

  it('dist/remy-firefox.zip is a valid ZIP archive with standard PK zip signature', () => {
    expect(existsSync(firefoxZip)).toBe(true);
    const buffer = readFileSync(firefoxZip);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });

  it('packages all required manifest, scripts, html, and icon assets inside zip', () => {
    const res = packageAll();
    const chromeFiles = res.chrome.files;
    const firefoxFiles = res.firefox.files;

    const requiredEntries = [
      'manifest.json',
      'background.js',
      'content.js',
      'options.html',
      'popup.html',
      'sidepanel.html',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'icons/icon-128.png',
    ];

    for (const entry of requiredEntries) {
      expect(chromeFiles).toContain(entry);
      expect(firefoxFiles).toContain(entry);
    }
  });

  it('throws a helpful error when packaging a non-existent directory', () => {
    const dummyDir = resolve(distDir, 'non_existent_folder_abc');
    const dummyZip = resolve(distDir, 'dummy.zip');
    expect(() => createZipArchive(dummyDir, dummyZip)).toThrow(/does not exist/);
  });
});
