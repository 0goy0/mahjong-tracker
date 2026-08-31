import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { PoolProvider } from './PoolContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <PoolProvider>
        <App />
      </PoolProvider>
    </BrowserRouter>
  </React.StrictMode>
);
