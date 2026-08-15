import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('robotAPI', {
  connect: (serverUrl: string) => ipcRenderer.invoke('robot:connect', serverUrl) as Promise<{ ok: boolean; message?: string }>,
  status: () => ipcRenderer.invoke('robot:status') as Promise<{ connected: boolean; serverUrl?: string; port: number; deviceName: string }>,
});
