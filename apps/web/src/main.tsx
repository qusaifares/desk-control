import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './design/index.js';
import { applyKioskMode } from './lib/kiosk.js';
import './styles.css';

applyKioskMode(window.location.search, document.documentElement);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
