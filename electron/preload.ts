import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  executeActivity: (id: string, props: Record<string, unknown>) =>
    ipcRenderer.invoke('automation:execute', id, props),
  getOpenWindows: () =>
    ipcRenderer.invoke('get-open-windows') as Promise<Array<{
      id: string;
      name: string;
      thumbnail: string;
      appIcon: string | null;
    }>>,
  pickDesktopElement: (windowTitle?: string) =>
    ipcRenderer.invoke('pick-desktop-element', windowTitle) as Promise<{
      cancelled: boolean;
      windowTitle?: string;
      name?: string;
      automationId?: string;
      className?: string;
      controlType?: string;
      selector?: string;
    }>,
  saveWorkflow: (content: string, existingPath: string | null, defaultName: string) =>
    ipcRenderer.invoke('save-workflow', content, existingPath, defaultName) as Promise<
      { cancelled: true } | { path: string }
    >,
  openWorkflow: () =>
    ipcRenderer.invoke('open-workflow') as Promise<
      { cancelled: true } | { path: string; content: string }
    >,
  getDotNetTypes: () => ipcRenderer.invoke('get-dotnet-types') as Promise<string[]>,
  getRunwayApiKey: (serverUrl: string) => ipcRenderer.invoke('runway:get-api-key', serverUrl) as Promise<string | null>,
  storeRunwayApiKey: (serverUrl: string, apiKey: string) => ipcRenderer.invoke('runway:store-api-key', serverUrl, apiKey) as Promise<boolean>,
  deleteRunwayApiKey: (serverUrl: string) => ipcRenderer.invoke('runway:delete-api-key', serverUrl) as Promise<void>,
  publishRunwayWorkflow: (url: string, apiKey: string, tenantId: string, payload: unknown) => ipcRenderer.invoke('runway:publish-workflow', { url, apiKey, tenantId, payload }) as Promise<{ networkError: boolean; status: number; body: string }>,
})
