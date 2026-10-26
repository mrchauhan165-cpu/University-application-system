import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from './UI';
import { Icon } from './Icons';
import { useApp } from '../context';
import { errorMessage } from '../../backend/errors';

/**
 * Opens a private attachment. Permission is re-checked by the backend on every
 * open; the resulting object/data URL is never cached, stored or shared.
 */
export function DocumentViewer({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { backend } = useApp();
  const [state, setState] = useState<{ error?: string; url?: string; name?: string; mime?: string }>({});

  useEffect(() => {
    try {
      const doc = backend.getDocumentDataUrl(docId);
      setState({ url: doc.dataUrl, name: doc.fileName, mime: doc.mime });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [backend, docId]);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={state.name ?? 'Document'}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {state.error ? (
        <Alert tone="danger" title="Not available.">{state.error}</Alert>
      ) : state.url ? (
        <div className="stack sm">
          {state.mime?.startsWith('image/') ? (
            <img
              src={state.url}
              alt={state.name ?? 'Attachment'}
              style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)' }}
            />
          ) : (
            <iframe
              title={state.name ?? 'Document'}
              src={state.url}
              style={{ width: '100%', height: '60vh', border: '1px solid var(--line)', borderRadius: 10 }}
            />
          )}
          <div className="row">
            <a className="btn secondary small" href={state.url} download={state.name}>
              <Icon.Download size={14} /> Download
            </a>
            <span className="cell-sub">Each open re-checks your current permission.</span>
          </div>
        </div>
      ) : (
        <p className="cell-sub">Loading…</p>
      )}
    </Modal>
  );
}
