import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../styles/index.css';
import { AgentPlaygroundApp } from './AgentPlaygroundApp';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', media.matches);
applyTheme();
media.addEventListener('change', applyTheme);

const root = document.getElementById('root');
if (!root) throw new Error('Agent Playground root element is missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AgentPlaygroundApp />
  </React.StrictMode>
);
