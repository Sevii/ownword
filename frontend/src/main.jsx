import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { count } from './app/telemetry.js';
import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-400-italic.css';
import '@fontsource/spectral/latin-500.css';
import '@fontsource/spectral/latin-600.css';
import './app/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker caches the app for offline use; it never caches /api.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then(
      (reg) => {
        // Some environments (test harnesses, locked-down browsers) resolve without a registration.
        if (reg && !navigator.serviceWorker.controller) {
          reg.addEventListener('updatefound', () => count('app.offline_ready'));
        }
      },
      () => {},
    );
  });
}
