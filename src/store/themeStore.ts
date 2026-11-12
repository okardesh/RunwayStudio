import { create } from 'zustand';

export type StudioTheme = 'dark' | 'light';
const THEME_KEY = 'runway.studio.theme';

function savedTheme(): StudioTheme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function applyStudioTheme(theme: StudioTheme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
  if (typeof window !== 'undefined') {
    const updateFrame = (window as any).electronAPI?.setStudioTheme;
    if (updateFrame) void Promise.resolve(updateFrame(theme)).catch(() => { /* The renderer theme remains usable. */ });
  }
}

export const useThemeStore = create<{ theme: StudioTheme; setTheme: (theme: StudioTheme) => void }>((set) => ({
  theme: savedTheme(),
  setTheme: (theme) => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Keep the session preference if storage is unavailable. */ }
    applyStudioTheme(theme);
    set({ theme });
  },
}));
