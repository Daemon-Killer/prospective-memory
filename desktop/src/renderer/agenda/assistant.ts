interface AssistantAPI {
  assistantConfig(): Promise<{ deviceId: string; tokenConfigured: boolean }>;
  assistantConnect(link: string): Promise<unknown>;
  assistantForget(): Promise<void>;
  assistantRequest(method: string, path: string, body?: string): Promise<string>;
}
interface Fact { id: string; value: string; kind: string; revision: number }

export function initPersonalAssistant(api: AssistantAPI) {
  const dialog = document.createElement('dialog');
  dialog.className = 'assistant-dialog';
  dialog.setAttribute('aria-label', 'Personal Assistant');
  dialog.innerHTML = `<div class="assistant-head"><div><small>ONE MEMORY · ALL YOUR DEVICES</small><h1>Personal Assistant</h1></div><button id="assistant-close" class="btn-secondary" aria-label="Close Personal Assistant">Close</button></div>
  <p id="assistant-status" role="status" aria-live="polite"></p>
  <section id="assistant-connection"><h2>Connect your memory</h2><p>Paste the same private setup link you use on your phone. Remy saves this connection using your system’s encrypted credential storage.</p><label for="assistant-link">Private setup link</label><input id="assistant-link" type="password" autocomplete="off" maxlength="2048" placeholder="https://…/agent/connect#key=…"><button id="assistant-connect" class="btn-primary">Connect this computer</button></section>
  <div id="assistant-content" hidden><nav class="assistant-actions"><button id="assistant-refresh" class="btn-primary">Refresh brief</button><button id="assistant-disconnect" class="btn-secondary">Forget this connection</button></nav>
  <section><h2>Your brief</h2><p id="assistant-updated"></p><div id="assistant-brief"></div></section>
  <section><h2>Shared memory</h2><p>Facts, goals and routines you choose to share. Your phone supplies selected notification previews.</p><div id="assistant-facts"></div>
  <form id="assistant-fact-form"><label for="assistant-kind">Remember as</label><select id="assistant-kind"><option value="fact">Fact</option><option value="goal">Goal</option><option value="routine">Routine</option><option value="preference">Preference</option></select><label for="assistant-fact">What should Remy remember?</label><textarea id="assistant-fact" maxlength="4000" required></textarea><button class="btn-primary" type="submit">Save to shared memory</button><button class="btn-secondary" type="button" id="assistant-cancel-edit" hidden>Cancel edit</button></form></section>
  <section><h2>Search captured memory</h2><form id="assistant-search-form"><label for="assistant-search">Words to find</label><input id="assistant-search" maxlength="500" placeholder="meeting, delivery, watch check-in…"><button class="btn-secondary">Search</button></form><div id="assistant-results"></div></section></div>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>('#' + id)!;
  let busy = false; let deviceId = ''; let editing: Fact | null = null;
  let newFactId = `fact-${crypto.randomUUID()}`;
  const request = async (method: string, route: string, body?: unknown) => JSON.parse(await api.assistantRequest(method, route, body === undefined ? undefined : JSON.stringify(body)));
  function line(parent: HTMLElement, text: string, tag = 'p') { const item = document.createElement(tag); item.textContent = text; parent.append(item); return item; }
  function button(parent: HTMLElement, label: string, action: () => void) { const item = document.createElement('button'); item.textContent = label; item.className = 'btn-secondary'; item.type = 'button'; item.onclick = action; parent.append(item); }
  function resetDraft() { editing = null; newFactId = `fact-${crypto.randomUUID()}`; el<HTMLTextAreaElement>('assistant-fact').value = ''; el('assistant-cancel-edit').hidden = true; }
  async function act(operation: () => Promise<void>) {
    if (busy) return; busy = true; el('assistant-status').textContent = 'Working…';
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(item => { if (item.id !== 'assistant-close') item.disabled = true; });
    try { await operation(); el('assistant-status').textContent = 'Up to date.'; }
    catch (error) { el('assistant-status').textContent = error instanceof Error ? error.message : 'Could not finish. Your draft is preserved.'; }
    finally { busy = false; dialog.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = false; }); }
  }
  async function refresh() {
    const [brief, context] = await Promise.all([request('GET', '/v1/brief'), request('GET', '/v1/context')]);
    el('assistant-connection').hidden = true; el('assistant-content').hidden = false;
    el('assistant-updated').textContent = `Updated ${new Date(brief.generated_at).toLocaleString()}${brief.reminder_source?.stale ? ' · reminder snapshot may be out of date' : ''}`;
    const root = el('assistant-brief'); root.replaceChildren();
    for (const [key, title] of [['overdue', 'Overdue'], ['due_today', 'Today'], ['upcoming', 'Coming up'], ['inbox', 'Inbox']] as const) {
      line(root, title, 'h3'); const items = brief[key] || [];
      if (!items.length) line(root, 'All clear');
      items.slice(0, 10).forEach((item: { title: string }) => line(root, item.title));
    }
    const facts = el('assistant-facts'); facts.replaceChildren();
    if (!context.facts?.length) line(facts, 'Add something you would like Remy to remember.');
    for (const fact of context.facts || []) {
      const card = document.createElement('article'); card.className = 'assistant-fact-card'; facts.append(card);
      line(card, fact.kind.toUpperCase(), 'small'); line(card, fact.value);
      button(card, 'Edit', () => { if (busy) return; editing = fact; el<HTMLSelectElement>('assistant-kind').value = fact.kind; el<HTMLTextAreaElement>('assistant-fact').value = fact.value; el('assistant-cancel-edit').hidden = false; el('assistant-fact').focus(); });
      button(card, 'Delete', () => { if (!busy && confirm('Delete this fact from shared memory?')) void act(async () => { await request('DELETE', `/v1/facts/${fact.id}?revision=${fact.revision}`); await refresh(); }); });
    }
  }
  document.getElementById('btn-assistant')!.onclick = () => { dialog.showModal(); void act(async () => { const config = await api.assistantConfig(); deviceId = config.deviceId; el('assistant-content').hidden = !config.tokenConfigured; el('assistant-connection').hidden = config.tokenConfigured; if (config.tokenConfigured) await refresh(); }); };
  el('assistant-close').onclick = () => dialog.close();
  el('assistant-connect').onclick = () => { void act(async () => { await api.assistantConnect(el<HTMLInputElement>('assistant-link').value); el<HTMLInputElement>('assistant-link').value = ''; await refresh(); }); };
  el('assistant-refresh').onclick = () => { void act(refresh); };
  el('assistant-disconnect').onclick = () => { void act(async () => { await api.assistantForget(); resetDraft(); el('assistant-brief').replaceChildren(); el('assistant-facts').replaceChildren(); el('assistant-results').replaceChildren(); el('assistant-content').hidden = true; el('assistant-connection').hidden = false; }); };
  el('assistant-cancel-edit').onclick = resetDraft;
  el('assistant-fact-form').onsubmit = event => { event.preventDefault(); void act(async () => {
    const value = el<HTMLTextAreaElement>('assistant-fact').value.trim(); if (!value) throw new Error('Enter something to remember.');
    const id = editing?.id || newFactId;
    await request('PUT', `/v1/facts/${id}`, { base_revision: editing?.revision || 0, kind: el<HTMLSelectElement>('assistant-kind').value, value, source_device_id: deviceId }); resetDraft(); await refresh();
  }); };
  el('assistant-search-form').onsubmit = event => { event.preventDefault(); void act(async () => {
    const data = await request('GET', `/v1/memories?q=${encodeURIComponent(el<HTMLInputElement>('assistant-search').value.trim())}&limit=50`);
    const results = el('assistant-results'); results.replaceChildren();
    if (!data.events?.length) line(results, 'No matching captured memory.');
    for (const event of data.events || []) { const card = document.createElement('article'); card.className = 'assistant-fact-card'; results.append(card); line(card, event.title || event.payload?.title || 'Captured memory', 'h3'); line(card, event.text || event.body || event.payload?.text || ''); line(card, new Date(event.occurred_at).toLocaleString(), 'small'); }
  }); };
}
