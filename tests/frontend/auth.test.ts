import { describe, expect, it } from 'vitest';
import { AuthController, hasAuthConfiguration } from '../../web/auth/session';
import type { MeResponse, PublicConfig } from '../../shared/contracts';
const me: MeResponse = { user: { id: 'u1', email: 'approved@example.invalid', role: 'leader' }, permissions: { viewContact: false, manageData: false, exportDetail: false } };
const config: PublicConfig = { appName: 'SIDAKSA', authConfigured: false, supabaseUrl: null, supabasePublishableKey: null, googleOAuthEnabled: false };
describe('verified private session gate', () => {
  it('requires configured endpoint and publishable key, not merely an enabled flag', () => {
    expect(hasAuthConfiguration(config)).toBe(false);
    expect(hasAuthConfiguration({ ...config, authConfigured: true })).toBe(false);
    expect(hasAuthConfiguration({ ...config, authConfigured: true, supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'public-key' })).toBe(true);
  });
  it('never authorizes until the server has checked identity and permissions', async () => {
    let resolve!: (value: MeResponse) => void;
    const controller = new AuthController(() => new Promise(r => { resolve = r; }));
    const pending = controller.accept('session');
    expect(controller.getSnapshot().phase).toBe('checking');
    expect(controller.getSnapshot().me).toBeNull();
    resolve(me); await pending;
    expect(controller.getSnapshot().phase).toBe('authorized');
    expect(controller.getSnapshot().me).toEqual(me);
    controller.clear();
    expect(controller.getSnapshot().me).toBeNull();
    expect(controller.getSnapshot().token).toBeNull();
  });
  it('cannot resurrect private state from a late request after logout', async () => {
    let resolve!: (value: MeResponse) => void;
    const controller = new AuthController(() => new Promise(r => { resolve = r; }));
    const pending = controller.accept('old-session'); controller.clear(); resolve(me); await pending;
    expect(controller.getSnapshot().phase).toBe('signed-out');
    expect(controller.getSnapshot().me).toBeNull();
  });
  it('rejects an unknown browser-side role even after a response', async () => {
    const controller = new AuthController(async () => ({ ...me, user: { ...me.user, role: 'superuser' } }) as unknown as MeResponse);
    await controller.accept('session');
    expect(controller.getSnapshot().phase).toBe('denied');
    expect(controller.getSnapshot().me).toBeNull();
  });
});
