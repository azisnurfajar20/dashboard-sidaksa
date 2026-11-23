import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SyntheticEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MeResponse, PublicConfig } from '../../shared/contracts';
import { ApiClient, ApiError } from '../lib/api';
import { AuthController, hasAuthConfiguration, type SessionState } from './session';
import { Brand, LoginView } from './Login';
interface AuthContextValue { config: PublicConfig | null; loaded: boolean; initializing: boolean; busy: boolean; error: string | null; session: SessionState; api: ApiClient; reload: () => void; passwordLogin: (email: string, password: string) => Promise<void>; googleLogin: () => Promise<void>; logout: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null); const [loaded, setLoaded] = useState(false); const [initializing, setInitializing] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);
  const sdk = useRef<SupabaseClient | null>(null);
  // Verification rejection is owned by AuthController's captured generation.
  const [controller] = useState(() => new AuthController((token, signal) => new ApiClient(() => token, () => {}).get<MeResponse>('/api/me', signal)));
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const api = useMemo(() => new ApiClient(() => { const current = controller.getSnapshot(); if (current.phase !== 'authorized') throw new ApiError(0, 'SESSION_UNVERIFIED', 'Izin akun belum terverifikasi. Tunggu atau masuk kembali.'); return current.token; }, failedToken => { if (controller.getSnapshot().token !== failedToken) return; controller.clear('Sesi berakhir. Silakan masuk kembali.'); void sdk.current?.auth.signOut({ scope: 'local' }); }), [controller]);
  useEffect(() => {
    let active = true; const abort = new AbortController(); setLoaded(false); setError(null); setInitializing(true);
    new ApiClient(() => null, () => {}).get<PublicConfig>('/api/public-config', abort.signal).then(value => {
      if (!active) return; setConfig(value); setLoaded(true); if (!hasAuthConfiguration(value)) setInitializing(false);
    }).catch(reason => { if (!active || reason?.name === 'AbortError') return; setConfig(null); setLoaded(true); setInitializing(false); setError('Konfigurasi akses tidak dapat dimuat. Periksa koneksi atau hubungi admin.'); });
    return () => { active = false; abort.abort(); };
  }, [retry]);
  useEffect(() => {
    if (!hasAuthConfiguration(config)) return;
    let active = true; setInitializing(true);
    const client = createClient(config!.supabaseUrl!, config!.supabasePublishableKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }); sdk.current = client;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return; setInitializing(false); void controller.accept(nextSession?.access_token ?? null);
    });
    // The SDK owns refresh and persistence. No app-owned password/token storage.
    client.auth.getSession().then(({ data, error: sessionError }) => { if (!active) return; setInitializing(false); if (sessionError) controller.clear('Sesi tidak dapat dipulihkan. Silakan masuk kembali.'); else if (controller.getSnapshot().token !== data.session?.access_token) void controller.accept(data.session?.access_token ?? null); });
    return () => { active = false; subscription.unsubscribe(); client.auth.stopAutoRefresh(); if (sdk.current === client) sdk.current = null; controller.clear(); };
  }, [config, controller]);
  async function passwordLogin(email: string, password: string) {
    if (!sdk.current || !hasAuthConfiguration(config)) return; setBusy(true); setError(null);
    try { const result = await sdk.current.auth.signInWithPassword({ email, password }); if (result.error) setError('Email atau kata sandi belum sesuai, atau login tidak tersedia. Coba lagi atau hubungi admin.'); }
    catch { setError('Login tidak dapat diproses. Periksa koneksi lalu coba lagi.'); } finally { setBusy(false); }
  }
  async function googleLogin() {
    if (!sdk.current || !config?.googleOAuthEnabled) return; setBusy(true); setError(null);
    try { const { error: oauthError } = await sdk.current.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } }); if (oauthError) setError('Login Google tidak dapat dimulai. Hubungi admin.'); }
    catch { setError('Login Google tidak dapat dimulai. Periksa koneksi.'); } finally { setBusy(false); }
  }
  async function logout() { controller.clear(); setBusy(true); setError(null); try { const result = await sdk.current?.auth.signOut({ scope: 'local' }); if (result?.error) setError('Tampilan pribadi telah ditutup, tetapi penghapusan sesi gagal. Coba keluar kembali sebelum menutup perangkat bersama.'); } catch { setError('Tampilan pribadi telah ditutup. Penghapusan sesi belum dapat diverifikasi.'); } finally { setBusy(false); } }
  return <AuthContext.Provider value={{ config, loaded, initializing, busy, error, session, api, reload: () => setRetry(v => v + 1), passwordLogin, googleLogin, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider is required'); return value; }
export function ProtectedApp({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const checking = auth.session.phase === 'checking';
  useEffect(() => {
    if (!checking) return;
    // A retained modal may own document-level keyboard handlers outside the inert tree.
    const block = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    document.addEventListener('keydown', block, true);
    return () => document.removeEventListener('keydown', block, true);
  }, [checking]);
  const pending = <main className="initializing"><Brand/><div role="status"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"/>{auth.loaded ? 'Memverifikasi izin akun…' : 'Memeriksa konfigurasi akses…'}</div><p>Data pribadi belum dimuat.</p></main>;
  if (!auth.loaded || auth.initializing || (checking && !auth.session.retainTree)) return pending;
  if (auth.session.phase !== 'authorized' && !checking) return <><LoginView config={auth.config} busy={auth.busy} error={auth.error ?? auth.session.error} onPassword={auth.passwordLogin} onGoogle={auth.googleLogin}/>{auth.config === null && <button className="btn btn-outline-primary config-retry" onClick={auth.reload} data-testid="config-retry">Coba muat konfigurasi lagi</button>}{auth.session.phase === 'denied' && <button className="btn btn-outline-primary config-retry" onClick={() => void auth.logout()}>Keluar dari sesi ini</button>}</>;
  function blockPendingInteraction(event: SyntheticEvent) { if (checking) { event.preventDefault(); event.stopPropagation(); } }
  return <>{checking && pending}<div key={auth.session.boundary ?? 0} hidden={checking} inert={checking || undefined} aria-hidden={checking || undefined} style={checking ? { display: 'none' } : undefined} onClickCapture={blockPendingInteraction} onSubmitCapture={blockPendingInteraction} onKeyDownCapture={blockPendingInteraction}>{children}</div></>;
}
