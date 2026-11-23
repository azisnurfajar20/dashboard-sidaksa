import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { createStore } from '../server/store.ts';
import { normalizeWorkbook } from '../server/domain/normalize.ts';
import { syntheticWorkbook } from '../tests/domain/fixture.ts';

const base = path.resolve('.private/test-tmp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'performance-'));
let server;
try {
  const raw = syntheticWorkbook();
  raw.fetchedAt = new Date().toISOString();
  const tab = raw.sheets.find(sheet => sheet.name === 'Proses Rekrutment');
  const template = tab.rows[1];
  tab.rows = [tab.rows[0], ...Array.from({ length: 10000 }, (_, index) => {
    const row = structuredClone(template); row.rowNumber = index + 2;
    row.cells[13].value = index % 3 === 0 ? 'Lolos' : index % 3 === 1 ? 'Tidak Lolos' : '';
    row.cells[14].value = index % 2 ? 'In Progress' : 'Closed';
    return row;
  })];
  const store = await createStore({ directory });
  const snapshot = normalizeWorkbook(raw, { referenceTabs: [], mappings: [] });
  assert.equal(snapshot.counts.applications, 10000);
  await store.publish(raw, snapshot);
  const config = { ...readConfig({ SIDAKSA_DATA_DIR: directory }), port: 0 };
  const app = await createApp({ config, store, allowFixtureForTests: true, authenticator: async token => {
    assert(/^load-(?:[0-9]|1[0-9])$/.test(token));
    return { id: token, email: 'synthetic-load@sidaksa.invalid', role: 'leader' };
  } });
  server = createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function sample(index) {
    const start = performance.now();
    const response = await fetch(origin + '/api/overview?snapshotId=' + encodeURIComponent(snapshot.id), { headers: { Authorization: `Bearer load-${index}`, Connection: 'close' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.meta.snapshotId, snapshot.id);
    assert.equal(body.metrics.find(metric => metric.key === 'applications').value, 10000);
    return performance.now() - start;
  }
  await sample(0); await sample(1);
  const values = [];
  for (let round = 0; round < 3; round++) values.push(...await Promise.all(Array.from({ length: 20 }, (_, index) => sample(index))));
  values.sort((a, b) => a - b);
  const percentile = n => Math.round(values[Math.ceil(values.length * n) - 1] * 100) / 100;
  const result = { testedAt: new Date().toISOString(), source: 'synthetic-isolated-fixture', liveIntegration: false, snapshotBinding: 'explicit-query-precondition',
    node: process.version, os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    applications: 10000, concurrentUsers: 20, requests: values.length, p50ms: percentile(0.5), p95ms: percentile(0.95), maxMs: percentile(1), targetP95ms: 2000, passed: percentile(0.95) <= 2000 };
  await mkdir('.private/evidence', { recursive: true });
  await writeFile('.private/evidence/performance.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
