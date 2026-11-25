import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVercelConfig } from '../../vercel';

// Load the same default exports Vercel uses, without any local .env or data store.
async function hostedApi() {
  const app = express();
  for (const path of ['public-config', 'me'] as const) {
    const entry = new URL(`../../api/${path}.ts`, import.meta.url).href;
    const handler = (await import(/* @vite-ignore */ entry)).default;
    app.all(`/api/${path}`, handler);
  }
  return request(app);
}

function configureAuth(key = 'sb_publishable_synthetic_fixture') {
  vi.stubEnv('SUPABASE_URL', 'https://auth.sidaksa.invalid');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', key);
  vi.stubEnv('AUTH_GOOGLE_ENABLED', 'false');
  vi.stubEnv('GOOGLE_REFERENCE_TABS', 'not-a-valid-google-setting');
  vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', 'SYNTHETIC_PRIVATE_PATH');
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Vercel sign-in endpoints', () => {
  it('keeps the SPA fallback for user pages but never rewrites API or assets to HTML', () => {
    const config = buildVercelConfig({});
    const rules: { source: string; destination: string }[] = config.rewrites;
    const fallback = rules.filter(rule => rule.destination === '/index.html').map(rule => new RegExp(`^${rule.source}$`, 'i'));
    const matches = (path: string) => fallback.some(pattern => pattern.test(path));
    for (const path of ['/', '/kandidat', '/password']) expect(matches(path), path).toBe(true);
    for (const path of ['/api', '/api/public-config', '/api/me', '/api/status', '/assets/example.js']) expect(matches(path), path).toBe(false);
  });

  it('serves login configuration from the runtime without a configured store or Sheets', async () => {
    configureAuth();
    const api = await hostedApi();
    const result = await api.get('/api/public-config').expect('Content-Type', /application\/json/).expect('Cache-Control', 'no-store').expect(200);
    expect(result.body).toEqual({ appName: 'SIDAKSA', authConfigured: true, supabaseUrl: 'https://auth.sidaksa.invalid', supabasePublishableKey: 'sb_publishable_synthetic_fixture', googleOAuthEnabled: false });
    await api.post('/api/public-config').expect('Allow', 'GET, HEAD').expect(405);
  });

  it('returns safe JSON without exposing a secret key or incomplete configuration', async () => {
    configureAuth('sb_secret_synthetic_do_not_expose');
    const api = await hostedApi();
    const failure = await api.get('/api/public-config').expect('Content-Type', /application\/json/).expect('Cache-Control', 'no-store').expect(503);
    expect(failure.body.error.code).toBe('AUTH_UNCONFIGURED');
    expect(failure.text).not.toContain('synthetic_do_not_expose');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    const result = await api.get('/api/public-config').expect(200);
    expect(result.body).toMatchObject({ authConfigured: false, supabaseUrl: null, supabasePublishableKey: null });
  });

  it('requires a real verifier response with approval in app_metadata', async () => {
    configureAuth();
    const fetcher = vi.fn<typeof fetch>();
    const identity = { id: 'fixture-user', email: 'fixture@example.invalid', user_metadata: { sidaksa_approved: true, sidaksa_role: 'admin' } };
    const user = (app_metadata: object) => new Response(JSON.stringify({ ...identity, app_metadata }), { headers: { 'Content-Type': 'application/json' } });
    fetcher.mockResolvedValueOnce(user({})).mockResolvedValueOnce(user({ sidaksa_approved: true, sidaksa_role: 'admin' }));
    vi.stubGlobal('fetch', fetcher);
    const api = await hostedApi();
    const unauthenticated = await api.get('/api/me').expect('Cache-Control', 'no-store').expect(401);
    expect(unauthenticated.body.error.code).toBe('AUTH_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
    const denied = await api.get('/api/me').set('Authorization', 'Bearer synthetic-token').expect(403);
    expect(denied.body.error.code).toBe('ACCOUNT_NOT_APPROVED');
    const approved = await api.get('/api/me').set('Authorization', 'Bearer synthetic-token').expect('Cache-Control', 'no-store').expect(200);
    expect(approved.body).toEqual({ user: { id: 'fixture-user', email: 'fixture@example.invalid', role: 'admin' }, permissions: { viewContact: true, manageData: true, exportDetail: true } });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://auth.sidaksa.invalid/auth/v1/user');
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('never grants permissions for malformed approved roles', async () => {
    configureAuth();
    const fetcher = vi.fn<typeof fetch>();
    const identity = (role: unknown) => new Response(JSON.stringify({ id: 'fixture-user', app_metadata: { sidaksa_approved: true, sidaksa_role: role } }), { headers: { 'Content-Type': 'application/json' } });
    fetcher.mockResolvedValueOnce(identity(['leader'])).mockResolvedValueOnce(identity('leader'));
    vi.stubGlobal('fetch', fetcher);
    const api = await hostedApi();
    const rejected = await api.get('/api/me').set('Authorization', 'Bearer fixture-token').expect('Cache-Control', 'no-store').expect(403);
    expect(rejected.body.error.code).toBe('ACCOUNT_NOT_APPROVED');
    expect(rejected.body).not.toHaveProperty('permissions');
    const leader = await api.get('/api/me').set('Authorization', 'Bearer fixture-token').expect(200);
    expect(leader.body.user.role).toBe('leader');
    expect(leader.body.permissions).toEqual({ manageData: false, viewContact: false, exportDetail: false });
  });
});
