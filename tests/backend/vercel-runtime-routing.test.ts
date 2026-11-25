import config from '../../vercel.json';
import { describe, expect, it } from 'vitest';
import { resolveDataRequest } from '../../server/vercel-data.js';
import { dataEntry, dataRoutes, idKey, routeKey } from '../../shared/vercel-routes.js';

function mapped(path: string) {
  const [pathname, search] = path.split('?');
  for (const { source, destination } of config.rewrites) {
    if (!destination.startsWith(`${dataEntry}?`)) continue;
    const match = new RegExp(`^${source.replace(`:${idKey}`, '([^/]+)')}$`).exec(pathname!);
    if (match) return destination + (match[1] ? `&${idKey}=${match[1]}` : '') + (search ? '&' + search : '');
  }
}

describe('Vercel routes for SIDAKSA data', () => {
  it('keeps all data routes on the same origin without intercepting login or assets', () => {
    const rules = config.rewrites.filter(rule => rule.destination.startsWith(`${dataEntry}?`));
    expect(rules.map(rule => rule.source)).toEqual(dataRoutes.map(route => `/api/${route.replace(':id', `:${idKey}`)}`));
    for (const [i, route] of dataRoutes.entries()) {
      const path = `/api/${route.replace(':id', 'fixture-123')}?limit=2`;
      expect(mapped(path)).toContain(`${routeKey}=${i}`);
      expect(resolveDataRequest(mapped(path)!)).toEqual(path);
      expect(resolveDataRequest(path)).toEqual(path);
    }
    for (const route of ['/api/public-config', '/api/me', '/api/sidaksa-cron', '/api/extra', '/assets/index.js']) {
      expect(mapped(route)).toBeUndefined();
      expect(resolveDataRequest(route)).toBeNull();
    }
  });

  it('preserves repeated filters and encodes identifiers without changing the selected route', () => {
    const id = encodeURIComponent('fixture / +?#%');
    const path = `/api/candidates/${id}?sort=name&sort=id`;
    expect(resolveDataRequest(mapped(path)!)).toBe(path);
    expect(resolveDataRequest(`${path}&${routeKey}=7&${idKey}=${id}`)).toBe(path);
    for (const url of [dataEntry, `${dataEntry}?${routeKey}=-1`, `${dataEntry}?${routeKey}=7`, `${dataEntry}?${routeKey}=7&${idKey}=a&${idKey}=b`, `/api/settings?${routeKey}=3`, `${dataEntry}?${routeKey}=3&${routeKey}=12`, `${dataEntry}?${routeKey}=3&${idKey}=x`]) {
      expect(resolveDataRequest(url)).toBeNull();
    }
  });
});