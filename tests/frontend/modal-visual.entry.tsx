// Offline visual fixture: real app, auth boundary, shared modal and installed CSS.
// Only the existing synthetic SDK/fetch boundaries are substituted; no live server.
import 'bootstrap/dist/css/bootstrap.min.css';
import '../../web/styles.css';
import './verified-findings.entry';
import { application, candidate, issue, meta } from './fixture';

const fixtureWindow = window as any;
const syntheticFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname.startsWith('/api/applications/') && (!init?.method || init.method === 'GET')) {
    fixtureWindow.__frontend.requests.push({ path: url.pathname + url.search, method: 'GET', body: null, completed: true });
    return new Response(JSON.stringify({ row: application, candidate, issues: [issue], meta: { ...meta, snapshotId: 'synthetic-A' } }), { headers: { 'Content-Type': 'application/json' } });
  }
  const response = await syntheticFetch(input, init);
  if (fixtureWindow.__modalLong && url.pathname === '/api/issues' && response.ok) {
    const value = await response.json();
    value.rows = value.rows.map((row: typeof issue) => ({ ...row, message: Array.from({ length: 32 }, (_, i) => `Bukti sintetis ${i + 1}: ${row.message} Teks panjang untuk memeriksa gulir dialog tanpa mengubah data sumber.`).join('\n') }));
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  }
  return response;
};
