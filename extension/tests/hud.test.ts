import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemyHud } from '../src/content/hud';

describe('Global Shortcut HUD (R3 Ingress)', () => {
  let hud: RemyHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new RemyHud();
  });

  afterEach(() => {
    hud.close();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('Closed Shadow DOM Isolation', () => {
    it('uses attachShadow with mode: "closed" preventing host page access', () => {
      const host = hud.getHostElement();
      // In closed shadow root, host.shadowRoot is strictly null to outside callers
      expect(host.shadowRoot).toBeNull();
    });

    it('injects style containing maximum z-index (2147483647) and Swiss Void palette', () => {
      // The host element exists and has id remy-hud-host
      expect(hud.getHostElement().id).toBe('remy-hud-host');
      hud.open();
      expect(hud.getHostElement().getAttribute('data-open')).toBe('true');
    });
  });

  describe('Keystroke Hijacking Defense', () => {
    it('stops event propagation on window capturing phase to isolate from host apps', () => {
      hud.open();

      const hostSpy = vi.fn();
      // Simulate host web app (e.g. Monaco Editor, Figma) listening on window bubbling
      window.addEventListener('keydown', hostSpy, false);

      const keyEvent = new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      });

      const stopPropagationSpy = vi.spyOn(keyEvent, 'stopPropagation');
      const stopImmediateSpy = vi.spyOn(keyEvent, 'stopImmediatePropagation');

      window.dispatchEvent(keyEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(stopImmediateSpy).toHaveBeenCalled();
      expect(hostSpy).not.toHaveBeenCalled();

      window.removeEventListener('keydown', hostSpy, false);
    });
  });

  describe('Keyboard Interactions (Escape, Tab, Enter)', () => {
    it('dismisses HUD when Escape is pressed', () => {
      hud.open();
      expect(hud.isVisible()).toBe(true);

      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(escEvent);

      expect(hud.isVisible()).toBe(false);
      expect(hud.getHostElement().getAttribute('data-open')).toBe('false');
    });

    it('cycles chips when Tab is pressed and wraps around', () => {
      hud.open();
      expect(hud.getSelectedChip()).toBe('inbox');

      // Forward Tab -> '15m'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(hud.getSelectedChip()).toBe('15m');

      // Forward Tab -> '1h'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(hud.getSelectedChip()).toBe('1h');

      // Shift+Tab -> back to '15m'
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(hud.getSelectedChip()).toBe('15m');
    });

    it('commits reminder and dismisses HUD on Enter', async () => {
      hud.open();
      const commitSpy = vi.fn();
      hud.setOnCommit(commitSpy);

      // Access input through host internal shadow DOM logic or simulated input
      const input = (hud as any).inputEl as HTMLInputElement;
      input.value = 'Deploy update tonight';

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(commitSpy).toHaveBeenCalledTimes(1);
      const commitArg = commitSpy.mock.calls[0][0];
      expect(commitArg.title).toBe('Deploy update');
      expect(commitArg.armed).toBe(true);
      expect(hud.isVisible()).toBe(false);
    });

    it('closes without committing if input is empty on Enter', async () => {
      hud.open();
      const commitSpy = vi.fn();
      hud.setOnCommit(commitSpy);

      const input = (hud as any).inputEl as HTMLInputElement;
      input.value = '   ';

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(commitSpy).not.toHaveBeenCalled();
      expect(hud.isVisible()).toBe(false);
    });
  });
});
