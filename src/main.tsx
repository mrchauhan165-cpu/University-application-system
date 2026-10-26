import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocalBackend } from './backend/local';
import './ui/styles.css';

/**
 * The portal runs entirely in the browser in demo mode: no server, no secrets,
 * no backend to keep alive. All authorisation rules are still enforced in the
 * service layer (see src/backend) — never only in the UI.
 */
const backend = new LocalBackend();

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');

createRoot(container).render(
  <StrictMode>
    <App backend={backend} />
  </StrictMode>,
);
