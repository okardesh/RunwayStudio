import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyStudioTheme, useThemeStore } from './store/themeStore';

applyStudioTheme(useThemeStore.getState().theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
