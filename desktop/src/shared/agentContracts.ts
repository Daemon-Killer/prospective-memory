export const AGENT_CLOUD_URL = 'https://prospective-memory-api.onrender.com/agent';
export interface AgentConfig { baseUrl: string; enabled: boolean; shareLearning: boolean; allowedPackages: string[]; deviceId: string; tokenConfigured: boolean }
export interface AgentStatus { pending: number; dropped: number; lastSuccessAt?: string; lastError?: string }
export interface AgentBridge {
  getConfig(): Promise<AgentConfig>;
  pairWithLink?(key: string): Promise<AgentConfig>;
  configure(config: Omit<AgentConfig, 'deviceId' | 'tokenConfigured'> & { token?: string }): Promise<AgentConfig>;
  status(): Promise<AgentStatus>;
  syncNow(): Promise<AgentStatus>;
  request(method: string, path: string, bodyJson?: string | null): Promise<string>;
}
