import { contextBridge, ipcRenderer } from 'electron';

export interface RemyAPI {
  // Spotlight HUD
  compilePreview: (text: string) => Promise<any>;
  submitCapture: (text: string) => Promise<any>;
  hideSpotlight: () => Promise<void>;
  onSpotlightFocus: (callback: () => void) => () => void;

  // Agenda
  listReminders: (status?: string) => Promise<any[]>;
  snoozeReminder: (id: string, preset: string) => Promise<any>;
  completeReminder: (id: string) => Promise<any>;
  deleteReminder: (id: string) => Promise<boolean>;
  syncNow: () => Promise<any>;
  getSyncStatus: () => Promise<{ status: string; lastSync: string | null }>;
  onAgendaRefresh: (callback: () => void) => () => void;
  onSyncStatusChange: (callback: (data: { status: string; lastSync: string | null }) => void) => () => void;
}

const api: RemyAPI = {
  compilePreview: (text: string) => ipcRenderer.invoke('spotlight:compile', text),
  submitCapture: (text: string) => ipcRenderer.invoke('spotlight:submit', text),
  hideSpotlight: () => ipcRenderer.invoke('spotlight:hide'),
  onSpotlightFocus: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('spotlight:focus', handler);
    return () => ipcRenderer.removeListener('spotlight:focus', handler);
  },

  listReminders: (status?: string) => ipcRenderer.invoke('agenda:list', status),
  snoozeReminder: (id: string, preset: string) => ipcRenderer.invoke('agenda:snooze', id, preset),
  completeReminder: (id: string) => ipcRenderer.invoke('agenda:complete', id),
  deleteReminder: (id: string) => ipcRenderer.invoke('agenda:delete', id),
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
};

contextBridge.exposeInMainWorld('remyAPI', api);
