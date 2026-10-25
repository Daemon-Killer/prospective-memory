import { AGENT_CLOUD_URL, AgentBridge, AgentConfig, AgentStatus } from './agentContracts';

export interface AgentVault {
  read(): { token: string; config: AgentConfig } | null;
  write(value: { token: string; config: AgentConfig } | null): void;
}

/** No browser credential persistence. Desktop injects an OS-encrypted vault. */
export class PortableAgentBridge implements AgentBridge {
  private token = '';
  private lastSuccessAt: string | undefined;
  private config: AgentConfig;
  constructor(deviceId: string, private readonly name: string, private readonly vault?: AgentVault, private readonly transport: typeof fetch = fetch) {
    this.config = { baseUrl: AGENT_CLOUD_URL, enabled: false, shareLearning: false, allowedPackages: [], deviceId, tokenConfigured: false };
    const saved = vault?.read();
    if (saved) {
      this.config = { ...saved.config, baseUrl: this.baseUrl(saved.config.baseUrl), enabled: false, allowedPackages: [], tokenConfigured: Boolean(saved.token) };
      this.token = this.validToken(saved.token);
    }
  }
  private baseUrl(raw: string) {
    if (raw.length > 2048 || /[\s\\]/.test(raw)) throw new Error('Use a valid HTTPS service URL.');
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !/^(\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname)) throw new Error('Use an HTTPS service URL without credentials, query or fragment.');
    return url.toString().replace(/\/+$/, '');
  }
  private validToken(value: string) {
    const token = value.trim();
    if (token.length < 32 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) throw new Error('Enter a valid private connection credential.');
    return token;
  }
  async getConfig() { return { ...this.config, allowedPackages: [...this.config.allowedPackages] }; }
  private save(token: string, config: AgentConfig) {
    // Persist first: failed keychain/file writes must not claim a saved connection.
    this.vault?.write({ token, config }); this.token = token; this.config = config;
  }
  async configure(input: Omit<AgentConfig, 'deviceId' | 'tokenConfigured'> & { token?: string }) {
    const baseUrl = this.baseUrl(input.baseUrl.trim());
    const token = input.token !== undefined ? this.validToken(input.token) : this.token;
    if (baseUrl !== this.config.baseUrl && input.token === undefined) throw new Error('Changing servers requires that server’s credential.');
    this.save(token, { ...this.config, baseUrl, enabled: false, shareLearning: Boolean(input.shareLearning), allowedPackages: [], tokenConfigured: Boolean(token) });
    return this.getConfig();
  }
  async pairWithLink(key: string) {
    if (!/^rpl_[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Use a valid private Remy setup link.');
    const data = JSON.parse(await this.send(AGENT_CLOUD_URL, '', 'POST', '/v1/pairing/exchange', JSON.stringify({ key, device_id: this.config.deviceId, name: this.name })));
    if (data.device_id !== this.config.deviceId || !/^rdv_[a-f0-9]{64}$/.test(data.device_token)) throw new Error('The server returned an invalid device credential.');
    this.save(data.device_token, { ...this.config, baseUrl: AGENT_CLOUD_URL, enabled: false, shareLearning: false, allowedPackages: [], tokenConfigured: true });
    return this.getConfig();
  }
  async forget() {
    this.vault?.write(null); this.token = ''; this.config = { ...this.config, tokenConfigured: false, enabled: false, shareLearning: false, allowedPackages: [] };
  }
  async status(): Promise<AgentStatus> { return { pending: 0, dropped: 0, ...(this.lastSuccessAt ? { lastSuccessAt: this.lastSuccessAt } : {}) }; }
  async syncNow() { await this.request('GET', '/v1/context'); return this.status(); }
  async request(method: string, path: string, bodyJson?: string | null) {
    if (!this.token) throw new Error('Connect your private setup link first.');
    return this.send(this.config.baseUrl, this.token, method, path, bodyJson);
  }
  private async send(baseUrl: string, token: string, method: string, path: string, bodyJson?: string | null) {
    const [route] = path.split('?');
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method) || !/^\/v1\/[A-Za-z0-9_./-]+$/.test(route) || route.split('/').some(segment => ['.', '..'].includes(segment)) || /[\\#\s]/.test(path) || path.length > 8192 || !/^[\x21-\x7e]+$/.test(path)) throw new Error('Invalid assistant request.');
    if (bodyJson && bodyJson.length > 1_000_000) throw new Error('Assistant request is too large.');
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      const result = await this.transport(baseUrl + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-AGENT-TOKEN': token } : {}) }, ...(bodyJson ? { body: bodyJson } : {}), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: abort.signal });
      if (!result.ok) throw new Error(result.status === 401 ? 'Connection expired or was revoked. Reconnect with a private setup link.' : `Assistant HTTP ${result.status}. Please retry.`);
      const text = await result.text();
      if (text.length > 2_000_000) throw new Error('Assistant response is too large.');
      this.lastSuccessAt = new Date().toISOString(); return text;
    } catch (error) {
      if (error instanceof Error && /^(Assistant |Connection expired)/.test(error.message)) throw error;
      throw new Error('Cannot reach your assistant. Check your connection and retry.');
    } finally { clearTimeout(timer); }
  }
}

export function browserDeviceId(): string {
  const key = 'remy-assistant-browser-device-v1';
  try {
    const existing = localStorage.getItem(key);
    if (existing && /^web-[A-Za-z0-9-]{8,80}$/.test(existing)) return existing;
    const id = `web-${crypto.randomUUID()}`; localStorage.setItem(key, id); return id;
  } catch { return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}
