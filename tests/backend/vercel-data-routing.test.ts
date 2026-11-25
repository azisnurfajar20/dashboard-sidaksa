import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { ApiError } from '../../server/auth.js';
import { readConfig } from '../../server/config.js';
import { normalizeWorkbook } from '../../server/domain/normalize.js';
import { createStore } from '../../server/store.js';
import { syntheticWorkbook } from '../domain/fixture.js';
import { buildVercelConfig as build } from '../../vercel';

const origin = 'https://sidaksa-api.example.invalid';
const frontend = 'dashboard-sidaksa.vercel.app';

describe('Vercel routes for SIDAKSA data', () => {
  it('routes the existing data API to a dedicated origin, preserving hosted login and the SPA', () => {
    const config = build({ SIDAKSA_BACKEND_ORIGIN: origin, VERCEL_PROJECT_PRODUCTION_URL: frontend });
    const rules = Object.fromEntries(config.rewrites.map(({source, destination}) => [source, destination]));
    for (const endpoint of ['health', 'status', 'dictionaries', 'overview', 'applications', 'applications/:id', 'candidates', 'candidates/:id', 'partners', 'departures', 'issues', 'issues/:id/review', 'settings', 'sync', 'mappings', 'audit', 'export']) {
      expect(rules[`/api/${endpoint}`]).toBe(`${origin}/api/${endpoint}`);
    }
    expect(config.rewrites.filter(r => r.destination.startsWith(origin))).toHaveLength(17);
    expect(config.headers).toEqual(config.rewrites.filter(r => r.destination.startsWith(origin)).map(({source}) => ({ source, headers: [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }] })));
    expect(rules['/']).toBe('/index.html');
    for (const endpoint of ['/api/public-config', '/api/me', '/api/:path*', '/assets/:path*']) expect(rules).not.toHaveProperty(endpoint);
    expect(build({}).rewrites.every(rule => rule.destination === '/index.html')).toBe(true);
  });

  it('rejects malformed destinations and obvious loops; never configures an insecure upstream', () => {
    expect(build({ SIDAKSA_BACKEND_ORIGIN: `${origin}/` }).rewrites.some(rule => rule.destination === `${origin}/api/overview`)).toBe(true);
    for (const candidate of ['http://api.example.invalid', 'https://localhost', 'https://127.0.0.1', 'https://api.example.invalid/path', 'https://api.example.invalid?secret=fixture', 'https://user:password@api.example.invalid', `https://${frontend}`, 'https://api.example.invalid/..', 'https://api.example.invalid#']) {
      expect(() => build({ SIDAKSA_BACKEND_ORIGIN: candidate, VERCEL_PROJECT_PRODUCTION_URL: frontend })).toThrow('SIDAKSA_BACKEND_ORIGIN');
    }
    expect(() => build({ SIDAKSA_BACKEND_ORIGIN: origin, VERCEL_URL: new URL(origin).host })).toThrow('SIDAKSA_BACKEND_ORIGIN');
  });

  it('maps the data page endpoints to authenticated Express JSON with the current snapshot', async () => {
    const rules = build({ SIDAKSA_BACKEND_ORIGIN: origin }).rewrites;
    const base = path.resolve('.private/test-tmp');
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(path.join(base, 'vercel-data-'));
    try {
      const raw = { ...syntheticWorkbook(), source: 'google-sheets' as const, spreadsheetId: 'SYNTHETIC_HOSTED_ROUTING' };
      const store = await createStore({ directory });
      const snapshot = normalizeWorkbook(raw, { referenceTabs: [], mappings: [] });
      await store.publish(raw, snapshot, 'fixture');
      const app = await createApp({ store, config: readConfig({ SIDAKSA_DATA_DIR: directory, GOOGLE_SPREADSHEET_ID: raw.spreadsheetId }), authenticator: async token => {
        if (token !== 'fixture-session') throw new ApiError(401, 'INVALID_TOKEN', 'Sesi tidak valid.');
        return { id: 'fixture-user', email: 'fixture@example.invalid', role: 'leader' };
      } });
      const route = (url: string) => {
        const source = new URL(url, 'https://site.example.invalid');
        const target = new URL(rules.find(rule => rule.source === source.pathname)!.destination);
        expect(target.origin).toBe(origin);
        return target.pathname + source.search;
      };
      await request(app).get(route('/api/overview')).expect('Content-Type', /json/).expect(401);
      const status = await request(app).get(route('/api/status')).set('Authorization', 'Bearer fixture-session').expect('Cache-Control', 'no-store').expect(200);
      expect(status.body.snapshot).toMatchObject({ id: snapshot.id, source: 'google-sheets', counts: snapshot.counts });
      const overview = await request(app).get(route(`/api/overview?snapshotId=${snapshot.id}`)).set('Authorization', 'Bearer fixture-session').expect('Content-Type', /json/).expect('Cache-Control', 'no-store').expect(200);
      expect(overview.body.meta.snapshotId).toBe(snapshot.id);
      const candidates = await request(app).get(route(`/api/candidates?snapshotId=${snapshot.id}&limit=1`)).set('Authorization', 'Bearer fixture-session').expect(200);
      expect(candidates.body.rows).toHaveLength(1);
      expect(candidates.body.rows[0]).not.toHaveProperty('phone');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
