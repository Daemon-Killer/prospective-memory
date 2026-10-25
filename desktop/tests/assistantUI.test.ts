// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initPersonalAssistant } from '../src/renderer/agenda/assistant';

const brief = { generated_at: '2026-10-25T06:00:00Z', overdue: [], due_today: [], upcoming: [], inbox: [], reminder_source: { stale: false } };
describe('assistant view', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="btn-assistant">Personal Assistant</button>'; HTMLDialogElement.prototype.showModal = function () { this.open = true; }; });
  function setup(facts: unknown[] = []) {
    const request = vi.fn(async (method: string, route: string, _body?: string) => {
      if (method === 'PUT') return JSON.stringify({ revision: 1 });
      return JSON.stringify(route === '/v1/brief' ? brief : { facts });
    });
    initPersonalAssistant({ assistantConfig: async () => ({ deviceId: 'desktop-test-device', tokenConfigured: true }), assistantConnect: async () => undefined, assistantForget: async () => undefined, assistantRequest: request });
    document.getElementById('btn-assistant')!.click();
    return request;
  }
  it('preserves the draft and reuses its ID after a lost save acknowledgement', async () => {
    const request = setup();
    await vi.waitFor(() => expect(document.getElementById('assistant-status')!.textContent).toBe('Up to date.'));
    const field = document.getElementById('assistant-fact') as HTMLTextAreaElement;
    const form = document.getElementById('assistant-fact-form')!;
    field.value = 'Study for two hours on weekdays';
    request.mockRejectedValueOnce(new Error('Connection lost after save'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('assistant-status')!.textContent).toContain('Connection lost'));
    expect(field.value).toBe('Study for two hours on weekdays');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('assistant-status')!.textContent).toBe('Up to date.'));
    const writes = request.mock.calls.filter(call => call[0] === 'PUT');
    expect(writes).toHaveLength(2);
    expect(writes[0][1]).toBe(writes[1][1]);
    expect(writes[0][2]).toBe(writes[1][2]);
    expect(field.value).toBe('');
  });
  it('renders captured facts as text and clears displayed memory when forgotten', async () => {
    setup([{ id: 'fact-1', kind: 'fact', revision: 1, value: '<img src=x onerror=alert(1)>' }]);
    await vi.waitFor(() => expect(document.getElementById('assistant-facts')!.textContent).toContain('<img src=x'));
    expect(document.querySelector('#assistant-facts img')).toBeNull();
    document.getElementById('assistant-disconnect')!.click();
    await vi.waitFor(() => expect(document.getElementById('assistant-content')!.hidden).toBe(true));
    expect(document.getElementById('assistant-facts')!.textContent).toBe('');
  });
});
