import type { MeResponse, PublicConfig } from '../../shared/contracts';
export function hasAuthConfiguration(config: PublicConfig | null): boolean {
  if (!config?.authConfigured || !config.supabaseUrl || !config.supabasePublishableKey) return false;
  try { const url = new URL(config.supabaseUrl); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); } catch { return false; }
}
export interface SessionState { phase: 'signed-out' | 'checking' | 'authorized' | 'denied'; token: string | null; me: MeResponse | null; error: string | null; boundary?: number; retainTree?: boolean }
// Tokens rotate independently of the verified identity/permission boundary.
function authority(me: MeResponse) { return JSON.stringify([me.user.id, me.user.email, me.user.role, Object.entries(me.permissions).sort(([a], [b]) => a.localeCompare(b))]); }
export class AuthController {
  private state: SessionState = { phase: 'signed-out', token: null, me: null, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private boundary = 0;
  private abort?: AbortController;
  constructor(private verify: (token: string, signal: AbortSignal) => Promise<MeResponse>) {}
  getSnapshot = (): SessionState => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(state: SessionState) { this.state = state; this.listeners.forEach(fn => fn()); }
  clear(error: string | null = null) { this.generation++; this.abort?.abort(); this.publish({ phase: 'signed-out', token: null, me: null, error, boundary: ++this.boundary }); }
  async accept(token: string | null) {
    if (!token) { this.clear(); return; }
    const previous = this.state.phase === 'authorized' || this.state.retainTree ? this.state.me : null;
    const generation = ++this.generation;
    this.abort?.abort(); this.abort = new AbortController();
    // Keep local state only behind the hidden, inert gate; API access is blocked until verification succeeds.
    this.publish({ phase: 'checking', token, me: previous, error: null, boundary: this.boundary, retainTree: !!previous });
    try {
      const me = await this.verify(token, this.abort.signal);
      if (generation !== this.generation) return;
      if (!['admin', 'recruiter', 'leader'].includes(me.user?.role) || typeof me.user?.id !== 'string' || !me.user.id || typeof me.user.email !== 'string' || !me.user.email || !me.permissions || ['viewContact', 'manageData', 'exportDetail'].some(key => typeof me.permissions[key as keyof MeResponse['permissions']] !== 'boolean')) throw new Error('Denied');
      if (!previous || authority(previous) !== authority(me)) this.boundary++;
      this.publish({ phase: 'authorized', token, me, error: null, boundary: this.boundary });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ phase: 'denied', token: null, me: null, error: 'Akses belum disetujui atau tidak dapat diverifikasi. Hubungi admin, lalu coba masuk kembali.', boundary: ++this.boundary });
    }
  }
}
