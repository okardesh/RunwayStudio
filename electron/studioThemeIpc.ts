import { type BrowserWindow, type IpcMain } from 'electron';

export function registerStudioThemeIpc(ipcMain: IpcMain, studioWindow: () => BrowserWindow | null) {
  ipcMain.handle('studio:set-theme', (event, theme: unknown) => {
    const win = studioWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents
      || event.senderFrame?.routingId !== win.webContents.mainFrame.routingId
      || event.senderFrame?.processId !== win.webContents.mainFrame.processId
      || (theme !== 'dark' && theme !== 'light')) return false;
    win.setBackgroundColor(theme === 'light' ? '#F4F7FB' : '#0A1120');
    if (process.platform === 'win32') win.setTitleBarOverlay({
      color: theme === 'light' ? '#FFFFFF' : '#101827',
      symbolColor: theme === 'light' ? '#475569' : '#94A3B8', height: 56,
    });
    return true;
  });
}
