import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { PoolProvider } from './PoolContext';
import { ThemeProvider, readStoredMode, applyMode } from './theme';
import './index.css';

// Apply the saved theme before first paint so there's no flash.
applyMode(readStoredMode());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <PoolProvider>
          <App />
        </PoolProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
