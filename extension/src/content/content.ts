/**
 * Remy Web Browser Extension - Content Script Entry
 * Injected into matching web pages. Compiled as a standalone IIFE bundle.
 */

import { RemyHud } from './hud';

(() => {
  if (typeof window === 'undefined') return;

  const hud = new RemyHud();

  hud.setOnCommit(async (data) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `remy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const reminder = {
      id,
      title: data.title,
      dueDate: data.dueDate.toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      armed: data.armed,
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        await chrome.runtime.sendMessage({
          type: 'CAPTURE_REMINDER',
          reminder,
        });
      } catch (err) {
        console.warn('[Remy Content] Could not send reminder to background:', err);
      }
    }
  });

  // Message listener for background events (e.g. TOGGLE_HUD from Ctrl+Shift+K)
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'TOGGLE_HUD') {
        hud.toggle();
        sendResponse({ status: 'ACK', visible: hud.isVisible() });
        return true;
      }
      return false;
    });
  }

  // Export to global for debug/test if needed
  (window as any).__REMY_HUD__ = hud;
})();
