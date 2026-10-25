import { contextBridge, ipcRenderer } from 'electron';

export interface RemyAPI {
  assistantConfig: () => Promise<{ deviceId: string; tokenConfigured: boolean }>;
  assistantConnect: (link: string) => Promise<unknown>;
  assistantForget: () => Promise<void>;
  assistantRequest: (method: string, route: string, body?: string) => Promise<string>;
  // Spotlight HUD
  compilePreview: (text: string) => Promise<any>;
  submitCapture: (text: string) => Promise<any>;
  hideSpotlight: () => Promise<void>;
  openSpotlight: () => Promise<void>;
  getCaptureShortcut: () => Promise<string>;
  onSpotlightFocus: (callback: () => void) => () => void;

  // Agenda
  listReminders: (status?: string, context?: string) => Promise<any[]>;
  snoozeReminder: (id: string, preset: string) => Promise<any>;
  completeReminder: (id: string) => Promise<any>;
  deleteReminder: (id: string) => Promise<boolean>;
  callReminder: (id: string) => Promise<boolean>;
  syncNow: () => Promise<any>;
  getSyncStatus: () => Promise<{ status: string; lastSync: string | null }>;
  onAgendaRefresh: (callback: () => void) => () => void;
  onSyncStatusChange: (callback: (data: { status: string; lastSync: string | null }) => void) => () => void;

  // Context Mode & Home Recollection
  getMode: () => Promise<string>;
  setMode: (mode: string) => Promise<string>;
  getRecollectionItems: () => Promise<any[]>;
  onModeChange: (callback: (mode: string) => void) => () => void;
}

const api: RemyAPI = {
  assistantConfig: () => ipcRenderer.invoke('assistant:config'),
  assistantConnect: link => ipcRenderer.invoke('assistant:connect', link),
  assistantForget: () => ipcRenderer.invoke('assistant:forget'),
  assistantRequest: (method, route, body) => ipcRenderer.invoke('assistant:request', method, route, body),
  compilePreview: (text: string) => ipcRenderer.invoke('spotlight:compile', text),
  submitCapture: (text: string) => ipcRenderer.invoke('spotlight:submit', text),
  hideSpotlight: () => ipcRenderer.invoke('spotlight:hide'),
  openSpotlight: () => ipcRenderer.invoke('spotlight:show'),
  getCaptureShortcut: () => ipcRenderer.invoke('spotlight:getShortcut'),
  onSpotlightFocus: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('spotlight:focus', handler);
    return () => ipcRenderer.removeListener('spotlight:focus', handler);
  },

  listReminders: (status?: string, context?: string) => ipcRenderer.invoke('agenda:list', status, context),
  snoozeReminder: (id: string, preset: string) => ipcRenderer.invoke('agenda:snooze', id, preset),
  completeReminder: (id: string) => ipcRenderer.invoke('agenda:complete', id),
  deleteReminder: (id: string) => ipcRenderer.invoke('agenda:delete', id),
  callReminder: (id: string) => ipcRenderer.invoke('agenda:call', id),
  syncNow: () => ipcRenderer.invoke('agenda:sync'),
  getSyncStatus: () => ipcRenderer.invoke('agenda:getSyncStatus'),
  onAgendaRefresh: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('agenda:refresh', handler);
    return () => ipcRenderer.removeListener('agenda:refresh', handler);
  },
  onSyncStatusChange: (callback: (data: { status: string; lastSync: string | null }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agenda:syncStatus', handler);
    return () => ipcRenderer.removeListener('agenda:syncStatus', handler);
  },

  getMode: () => ipcRenderer.invoke('mode:get'),
  setMode: (mode: string) => ipcRenderer.invoke('mode:set', mode),
  getRecollectionItems: () => ipcRenderer.invoke('recollection:list'),
  onModeChange: (callback: (mode: string) => void) => {
    const handler = (_event: any, mode: string) => callback(mode);
    ipcRenderer.on('agenda:modeChanged', handler);
    return () => ipcRenderer.removeListener('agenda:modeChanged', handler);
  },
};

contextBridge.exposeInMainWorld('remyAPI', api);
