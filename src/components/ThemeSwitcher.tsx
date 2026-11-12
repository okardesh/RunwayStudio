import { useThemeStore } from '../store/themeStore';
import { Icon } from './Icon';

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeStore();
  return <div className="theme-switcher" role="group" aria-label="Appearance">
    <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title="Use dark theme"><Icon name="moon" size={14} /><span>Dark</span></button>
    <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title="Use light theme"><Icon name="sun" size={14} /><span>Light</span></button>
  </div>;
}
