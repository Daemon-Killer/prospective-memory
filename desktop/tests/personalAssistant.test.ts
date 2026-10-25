import { describe, it, expect, vi } from 'vitest';
import { PortableAgentBridge, AgentVault } from '../src/shared/portableAgentBridge';

const key = 'rpl_' + 'a'.repeat(43);
const token = 'rdv_' + 'b'.repeat(64);
const device = 'desktop-11111111-1111-1111-1111-111111111111';
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('desktop assistant connection', () => {
  it('exchanges the private link in a POST body and keeps credentials out of public configuration', async () => {
    const transport = vi.fn().mockResolvedValue(reply({ device_id: device, device_token: token }));
    const write = vi.fn();
    const client = new PortableAgentBridge(device, 'Remy on Windows', { read: () => null, write }, transport);
    await client.pairWithLink(key);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://prospective-memory-api.onrender.com/agent/v1/pairing/exchange');
    expect(options.headers).not.toHaveProperty('X-AGENT-TOKEN');
    expect(JSON.parse(options.body)).toEqual({ key, device_id: device, name: 'Remy on Windows' });
    expect(JSON.stringify(await client.getConfig())).not.toContain(token);
    expect(write.mock.calls[0][0].token).toBe(token);
  });
  it('refuses URL traversal and credential-bearing hosts before sending any credential', async () => {
    const transport = vi.fn();
    const client = new PortableAgentBridge(device, 'Mac', undefined, transport);
    await client.configure({ baseUrl: 'https://example.com/agent', token, enabled: false, shareLearning: false, allowedPackages: [] });
    for (const route of ['/v1/../../bad', '/v1/%2e%2e/bad', '//evil.example/v1/context', '/v1/context#key=secret', '/v1\\evil']) await expect(client.request('GET', route)).rejects.toThrow();
    await expect(client.configure({ baseUrl: 'https://user:secret@evil.example/agent', token, enabled: false, shareLearning: false, allowedPackages: [] })).rejects.toThrow();
    await expect(client.configure({ baseUrl: 'https://other.example/agent', enabled: false, shareLearning: false, allowedPackages: [] })).rejects.toThrow('Changing servers');
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not activate a connection if encrypted persistence fails', async () => {
    const transport = vi.fn().mockResolvedValue(reply({ device_id: device, device_token: token }));
    const vault: AgentVault = { read: () => null, write: () => { throw new Error('Keychain unavailable'); } };
    const client = new PortableAgentBridge(device, 'Mac', vault, transport);
    await expect(client.pairWithLink(key)).rejects.toThrow('Keychain unavailable');
    expect((await client.getConfig()).tokenConfigured).toBe(false);
  });
  it('retains an existing connection when exchange returns a different installation', async () => {
    const transport = vi.fn().mockResolvedValue(reply({ device_id: 'wrong-device', device_token: token }));
    const client = new PortableAgentBridge(device, 'Mac', undefined, transport);
    await expect(client.pairWithLink(key)).rejects.toThrow('invalid device credential');
    expect((await client.getConfig()).tokenConfigured).toBe(false);
  });
  it('clears the credential when forgetting and sanitizes failed request errors', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('transport leaked ' + token));
    const write = vi.fn();
    const client = new PortableAgentBridge(device, 'Windows', { read: () => null, write }, transport);
    await client.configure({ baseUrl: 'https://example.com/agent', token, enabled: false, shareLearning: false, allowedPackages: [] });
    await expect(client.request('GET', '/v1/context')).rejects.toThrow('Cannot reach your assistant.');
    await client.forget();
    expect(write).toHaveBeenLastCalledWith(null);
    await expect(client.request('GET', '/v1/context')).rejects.toThrow('Connect your private setup link');
  });
});
