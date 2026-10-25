import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PortableAgentBridge, AgentVault } from '../shared/portableAgentBridge';
import { parseAgentPairingLink } from '../../../reminder app/src/services/agentPairingLink';

/** The renderer receives summaries and facts, never the saved credential. */
export function createPersonalAssistant(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'assistant-connection.bin');
  const idFile = path.join(directory, 'assistant-install-id');
  const deviceId = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : `desktop-${randomUUID()}`;
  if (!/^desktop-[a-f0-9-]{36}$/.test(deviceId)) throw new Error('The assistant installation ID could not be read.');
  if (!fs.existsSync(idFile)) fs.writeFileSync(idFile, deviceId, { mode: 0o600 });
  const vault: AgentVault = {
    read() {
      if (!fs.existsSync(filename)) return null;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock your system keychain to connect the assistant.');
      try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(filename))); }
      catch { throw new Error('The saved assistant connection could not be unlocked.'); }
    },
    write(value) {
      if (!value) { if (fs.existsSync(filename)) fs.unlinkSync(filename); return; }
      if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('An encrypted system keychain is required to save the assistant connection.');
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      fs.writeFileSync(filename + '.tmp', encrypted, { mode: 0o600 });
      fs.renameSync(filename + '.tmp', filename);
    },
  };
  const client = new PortableAgentBridge(deviceId, process.platform === 'darwin' ? 'Remy on Mac' : 'Remy on Windows', vault);
  return {
    config: () => client.getConfig(),
    async connect(link: string) {
      const key = typeof link === 'string' && parseAgentPairingLink(link);
      if (!key) throw new Error('Paste a valid private Remy setup link.');
      await client.pairWithLink(key);
      await client.request('GET', '/v1/context');
      return client.getConfig();
    },
    forget: () => client.forget(),
    request(method: string, route: string, body?: string | null) {
      // A narrow IPC surface; no arbitrary hosts, headers or pairing administration.
      const allowed = (method === 'GET' && /^\/v1\/(brief|context|memories(?:\?q=[^#]*&limit=50)?)$/.test(route))
        || (method === 'PUT' && /^\/v1\/facts\/[A-Za-z0-9._-]{1,128}$/.test(route))
        || (method === 'DELETE' && /^\/v1\/facts\/[A-Za-z0-9._-]{1,128}\?revision=\d+$/.test(route));
      if (!allowed) throw new Error('Unsupported assistant action.');
      return client.request(method, route, body);
    },
  };
}
