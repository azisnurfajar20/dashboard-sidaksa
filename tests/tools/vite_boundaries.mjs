import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'vite';
import config from '../../vite.config.ts';

const root = process.cwd();
const base = path.resolve('.private/test-tmp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'vite-boundaries-'));
const file = path.join(directory, 'private-probe.txt');
const marker = 'SIDAKSA_FICTITIOUS_PRIVATE_BOUNDARY_TEST';
let vite;
try {
  await writeFile(file, marker, 'utf8');
  vite = await createServer({
    ...config, configFile: false, root,
    cacheDir: path.join(directory, 'cache'), logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: true, preTransformRequests: false },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const control = await fetch(`${origin}/web/lib/query.ts`);
  assert.equal(control.status, 200, 'Legitimate frontend source must remain accessible');
  const routes = [
    `/${path.relative(root, file).split(path.sep).join('/')}`,
    `/@fs/${file.split(path.sep).join('/')}`,
  ];
  const results = [];
  for (const route of routes) {
    const response = await fetch(origin + encodeURI(route));
    const body = await response.text();
    results.push({ status: response.status, leaked: body.includes(marker) });
  }
  console.log(JSON.stringify({ control: control.status, privateRoutes: results }));
  assert(results.every(r => !r.leaked && [403, 404].includes(r.status)), 'Development HTTP must deny private files and @fs variants');
} finally {
  if (vite) await vite.close();
  await rm(directory, { recursive: true, force: true });
}
