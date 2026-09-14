/**
 * Remy Global Shortcut HUD
 * Injected closed Shadow DOM HUD (attachShadow({ mode: 'closed' }))
 * Swiss Void design palette (#000000 void black, #222222 borders, #FF4500 accent)
 * Tabular-nums for zero-shift layout
 * Keystroke hijacking defense with window capturing listeners
 */

import { compileCapture, CaptureChip } from '@core/captureCompilerCore';

const CHIPS: CaptureChip[] = ['inbox', '15m', '1h', 'evening', 'tomorrow_morning'];

export class RemyHud {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private isOpen = false;
  private selectedChipIndex = 0;
  private previousFocusedElement: HTMLElement | null = null;

  private inputEl!: HTMLInputElement;
  private chipEls: HTMLElement[] = [];
  private onCommitCallback?: (data: { raw: string; chip: CaptureChip; title: string; armed: boolean; dueDate: Date }) => Promise<void> | void;

  constructor() {
    this.host = document.createElement('remy-hud-host');
    this.host.id = 'remy-hud-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.render();
  }

  public getHostElement(): HTMLElement {
    return this.host;
  }

  public isVisible(): boolean {
    return this.isOpen;
  }

  public setOnCommit(cb: (data: { raw: string; chip: CaptureChip; title: string; armed: boolean; dueDate: Date }) => Promise<void> | void) {
    this.onCommitCallback = cb;
  }

  private render() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        display: none;
        pointer-events: auto;
      }
      :host([data-open="true"]) {
        display: block;
      }
      .remy-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(4px);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 15vh;
        box-sizing: border-box;
      }
      .remy-dialog {
        background: #000000;
        border: 1px solid #222222;
        border-radius: 8px;
        width: 580px;
        max-width: 90vw;
        padding: 16px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.95);
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        box-sizing: border-box;
      }
      .remy-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-size: 11px;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        font-weight: 700;
        color: #888888;
      }
      .remy-brand {
        color: #ff4500;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .remy-brand-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #ff4500;
      }
      .remy-input {
        width: 100%;
        background: #0a0a0a;
        border: 1px solid #333333;
        border-radius: 6px;
        padding: 12px 14px;
        font-size: 15px;
        color: #ffffff;
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
        transition: border-color 0.15s ease;
      }
      .remy-input:focus {
        border-color: #ff4500;
      }
      .remy-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 14px;
        font-size: 12px;
      }
      .remy-chips {
        display: flex;
        gap: 6px;
      }
      .remy-chip {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #222222;
        background: #111111;
        color: #888888;
        font-size: 11px;
        font-family: 'SF Mono', Monaco, Consolas, monospace;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        user-select: none;
        transition: all 0.1s ease;
      }
      .remy-chip[data-active="true"] {
        border-color: #ff4500;
        background: rgba(255, 69, 0, 0.15);
        color: #ff4500;
        font-weight: 600;
      }
      .remy-hints {
        color: #555555;
        font-size: 11px;
        display: flex;
        gap: 8px;
        font-variant-numeric: tabular-nums;
      }
      .remy-kbd {
        background: #1a1a1a;
        border: 1px solid #333333;
        border-radius: 3px;
        padding: 1px 4px;
        color: #aaaaaa;
        font-family: monospace;
      }
    `;

    const container = document.createElement('div');
    container.className = 'remy-backdrop';
    container.innerHTML = `
      <div class="remy-dialog">
        <div class="remy-header">
          <div class="remy-brand"><span class="remy-brand-dot"></span> Remy Capture</div>
          <div class="remy-status">Sub-400ms HUD</div>
        </div>
        <input type="text" class="remy-input" id="remy-input" placeholder="What's on your mind? (Tab toggles preset, Enter commits)" autocomplete="off" />
        <div class="remy-footer">
          <div class="remy-chips" id="remy-chips">
            <span class="remy-chip" data-index="0" data-active="true">Inbox</span>
            <span class="remy-chip" data-index="1" data-active="false">+15m</span>
            <span class="remy-chip" data-index="2" data-active="false">+1h</span>
            <span class="remy-chip" data-index="3" data-active="false">Evening</span>
            <span class="remy-chip" data-index="4" data-active="false">Tomorrow</span>
          </div>
          <div class="remy-hints">
            <span><span class="remy-kbd">Tab</span> chip</span>
            <span><span class="remy-kbd">↵</span> save</span>
            <span><span class="remy-kbd">Esc</span> exit</span>
          </div>
        </div>
      </div>
    `;

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    this.inputEl = container.querySelector('#remy-input') as HTMLInputElement;
    this.chipEls = Array.from(container.querySelectorAll('.remy-chip')) as HTMLElement[];

    // Clicking chip directly
    this.chipEls.forEach((chip, idx) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setChipIndex(idx);
      });
    });

    // Backdrop click dismisses
    container.addEventListener('click', (e) => {
      if (e.target === container) {
        this.close();
      }
    });
  }

  private handleKeyCapture = (e: KeyboardEvent) => {
    if (!this.isOpen) return;

    // Defense against host web apps (Monaco, Google Docs, Figma, Notion)
    // Stopping propagation at the capture phase prevents host app listeners on window/document/elements
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.type !== 'keydown') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const delta = e.shiftKey ? -1 : 1;
      this.cycleChip(delta);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
      return;
    }
  };

  public setChipIndex(index: number) {
    this.selectedChipIndex = (index + CHIPS.length) % CHIPS.length;
    this.chipEls.forEach((chip, i) => {
      chip.setAttribute('data-active', i === this.selectedChipIndex ? 'true' : 'false');
    });
  }

  public cycleChip(delta: number = 1) {
    this.setChipIndex(this.selectedChipIndex + delta);
  }

  public getSelectedChip(): CaptureChip {
    return CHIPS[this.selectedChipIndex];
  }

  public open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.previousFocusedElement = document.activeElement as HTMLElement | null;

    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }
    this.host.setAttribute('data-open', 'true');

    // Register capturing event listeners on window
    window.addEventListener('keydown', this.handleKeyCapture, { capture: true, passive: false });
    window.addEventListener('keyup', this.handleKeyCapture, { capture: true, passive: false });
    window.addEventListener('keypress', this.handleKeyCapture, { capture: true, passive: false });

    setTimeout(() => {
      this.inputEl.focus();
    }, 10);
  }

  public close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.host.setAttribute('data-open', 'false');

    window.removeEventListener('keydown', this.handleKeyCapture, { capture: true });
    window.removeEventListener('keyup', this.handleKeyCapture, { capture: true });
    window.removeEventListener('keypress', this.handleKeyCapture, { capture: true });

    this.inputEl.value = '';
    this.setChipIndex(0);

    if (this.previousFocusedElement && typeof this.previousFocusedElement.focus === 'function') {
      this.previousFocusedElement.focus();
    }
  }

  public toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public async commit() {
    const raw = this.inputEl.value.trim();
    if (!raw) {
      this.close();
      return;
    }

    const chip = this.getSelectedChip();
    const draft = compileCapture(raw, chip, new Date());

    this.close();

    if (this.onCommitCallback) {
      await this.onCommitCallback({
        raw,
        chip,
        title: draft.title || raw,
        armed: draft.armed,
        dueDate: draft.dueDate,
      });
    }
  }
}
