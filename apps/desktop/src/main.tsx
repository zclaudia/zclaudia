import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@zclaudia/agent-transcript-kit/transcript.css';
import './styles/index.css';
import { initLogger } from './services/logger';

initLogger();

// First paint happens with .no-transitions (set on <html> in index.html) so
// theme hydration doesn't animate every surface; drop it after the first
// painted frame.
requestAnimationFrame(() => {
  requestAnimationFrame(() => document.documentElement.classList.remove('no-transitions'));
});

// Suppress the WebView's default context menu (Reload, etc.) in production
// chrome. Text-editing surfaces and real text selections keep the native menu.
if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const editable = target?.closest('input, textarea, [contenteditable="true"]');
    const hasSelection = Boolean(window.getSelection()?.toString());
    if (!editable && !hasSelection) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
