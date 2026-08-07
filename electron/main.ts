import { app, BrowserWindow, Menu, ipcMain, desktopCapturer } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { executeActivity } from './automation/index.js'
import { pickDesktopElement } from './automation/picker.js'

const _require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_ROOT = path.join(__dirname, '..')
process.env.APP_ROOT = APP_ROOT

export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null

function createWindow() {
  // Remove the default native menu bar — the app has its own toolbar
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1E1F2E',
    title: 'RPA Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,       // required for the Element Recorder
    },
  })

  win.maximize()

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  // Handle all automation activity execution requests from the renderer
  ipcMain.handle('automation:execute', async (_e, id: string, props: Record<string, unknown>) =>
    executeActivity(id, props)
  );

  // Return all open windows with title and base64 thumbnail for the Indicate modal
  ipcMain.handle('get-open-windows', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 160, height: 100 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name && s.name !== 'Entire Screen' && !s.name.startsWith('Screen '))
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      }));
  });

  // Point-and-click desktop element picker — minimizes the app so the target
  // window is reachable, then restores it once an element is captured/cancelled.
  ipcMain.handle('pick-desktop-element', async (_e, windowTitle?: string) => {
    win?.minimize();
    try {
      return await pickDesktopElement(windowTitle ?? '');
    } finally {
      win?.restore();
      win?.focus();
    }
  });

  createWindow();
})
