import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AppData, SessionUser } from '../domain/types';
import type { LocalBackend } from '../backend/local';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface AppContextValue {
  backend: LocalBackend;
  version: number;
  session: SessionUser | null;
  data: AppData;
  route: Route;
  navigate: (to: string) => void;
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
}

export interface Route {
  /** e.g. "/applications/ap_123" */
  path: string;
  /** path split into segments, query removed */
  segments: string[];
  query: URLSearchParams;
}

const AppContext = createContext<AppContextValue | null>(null);

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const segments = path.split('/').filter(Boolean);
  return { path, segments, query: new URLSearchParams(queryPart ?? '') };
}

export function useRouteState(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  const target = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function AppProvider({ backend, children }: { backend: LocalBackend; children: ReactNode }) {
  const version = useSyncExternalStore(
    (cb) => backend.subscribe(cb),
    () => backend.getVersion(),
    () => backend.getVersion(),
  );
  const route = useRouteState();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'info') => {
      counter.current += 1;
      const id = counter.current;
      setToasts((list) => [...list.slice(-3), { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
      }, 5200);
    },
    [],
  );

  const session = backend.getSession();
  const data = useMemo(() => backend.getView(), [backend, version, session?.profile.id]);

  const value = useMemo<AppContextValue>(
    () => ({
      backend,
      version,
      session,
      data,
      route,
      navigate,
      toasts,
      notify,
      dismissToast,
    }),
    [backend, version, session, data, route, toasts, notify, dismissToast],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function useSession(): SessionUser {
  const { session } = useApp();
  if (!session) throw new Error('useSession requires a signed-in user');
  return session;
}

/** True when the current user holds at least one grant with this permission. */
export function useCan(permission: import('../domain/types').Permission): boolean {
  const { session } = useApp();
  return Boolean(session?.permissions.includes(permission));
}
