export const dataRoutes = [
  'health', 'status', 'dictionaries', 'overview', 'applications', 'applications/:id',
  'candidates', 'candidates/:id', 'partners', 'departures', 'issues', 'issues/:id/review',
  'settings', 'sync', 'mappings', 'audit', 'export',
] as const;
export const routeKey = '__sidaksa_route', idKey = '__sidaksa_id';
export const dataEntry = '/api/sidaksa-data';