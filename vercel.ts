import { isIP } from 'node:net';

// Only the application's data API is forwarded. The Vercel auth functions
// and static frontend never depend on the data backend being available.
const dataEndpoints = [
  'health', 'status', 'dictionaries', 'overview', 'applications', 'applications/:id',
  'candidates', 'candidates/:id', 'partners', 'departures', 'issues', 'issues/:id/review',
  'settings', 'sync', 'mappings', 'audit', 'export',
] as const;

function dataOrigin(env: NodeJS.ProcessEnv) {
  const value = env.SIDAKSA_BACKEND_ORIGIN?.trim();
  if (!value) return null;
  const invalid = () => new Error('SIDAKSA_BACKEND_ORIGIN harus berupa origin HTTPS backend yang terpisah, tanpa path, kredensial, query, atau fragmen.');
  const authority = /^https:\/\/([a-z0-9.-]+)(?::443)?\/?$/i.exec(value)?.[1]?.toLowerCase();
  const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(authority ?? '');
  if (!authority || !hostname || isIP(authority) || /\.(localhost|local|internal)$/.test(authority)) throw invalid();
  const url = new URL(value);
  if (url.hostname !== authority) throw invalid();
  const frontendHosts = new Set([
    'dashboard-sidaksa.vercel.app',
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase(),
    env.VERCEL_URL?.trim().toLowerCase(),
    env.VERCEL_BRANCH_URL?.trim().toLowerCase(),
  ]);
  if (frontendHosts.has(url.hostname)) throw invalid();
  return url.origin;
}

export function buildVercelConfig(env: NodeJS.ProcessEnv) {
  const origin = dataOrigin(env);
  const dataPaths = origin ? dataEndpoints.map(endpoint => `/api/${endpoint}`) : [];
  return {
    framework: 'vite',
    buildCommand: 'npm run build',
    outputDirectory: 'dist/client',
    rewrites: [
      ...dataPaths.map(source => ({ source, destination: `${origin}${source}` })),
      { source: '/', destination: '/index.html' },
      { source: '/(rekrutmen|kandidat|mitra|keberangkatan|kualitas-data|pengaturan|password)', destination: '/index.html' },
    ],
    headers: dataPaths.map(source => ({ source, headers: [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }] })),
  };
}

export const config = buildVercelConfig(process.env);