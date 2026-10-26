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
const container = document.getElementById('root');

function fatal(message: string, detail?: string) {
  if (!container) return;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:560px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;color:#0b2545';
  wrap.innerHTML =
    `<h1 style="font-size:1.2rem;margin:0 0 8px">The portal could not start</h1>
     <p style="font-size:.9rem;line-height:1.6;color:#465a75">${message}</p>
     ${detail ? `<pre style="font-size:.75rem;background:#f1f4f9;padding:12px;border-radius:8px;overflow:auto">${detail}</pre>` : ''}
     <button style="margin-top:12px;padding:9px 14px;border-radius:9px;border:0;background:#1e56a0;color:#fff;font:inherit;cursor:pointer"
       onclick="location.reload()">Reload</button>`;
  container.appendChild(wrap);
}

if (!container) {
  throw new Error('Root element missing');
}

try {
  const backend = new LocalBackend();
  createRoot(container).render(
    <StrictMode>
      <App backend={backend} />
    </StrictMode>,
  );
} catch (error) {
  const message =
    'Your browser blocked something the page needs (usually local storage). Try a normal browser tab, or allow storage for this site, then reload.';
  // eslint-disable-next-line no-console
  console.error('Portal boot failed', error);
  fatal(message, error instanceof Error ? error.message : String(error));
}
