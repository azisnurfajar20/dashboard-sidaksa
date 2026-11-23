import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RawWorkbook } from '../../shared/contracts';
import { createStore } from '../../server/store';
import { createSyncService } from '../../server/sync';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function privateDirectory() {
  await mkdir('.private/test-tmp', { recursive: true });
  const directory = await mkdtemp(path.resolve('.private/test-tmp/d1-persistence-'));
  directories.push(directory); return directory;
}

describe('D1 real private fixture persistence (not live Sheets)', () => {
  it('keeps 612 applications after repeated refresh, rejects a broken batch, and actually restores the backup', async () => {
    const raw: RawWorkbook = JSON.parse(await readFile(new URL('../../.private/fixtures/source.json', import.meta.url), 'utf8'));
    const references = ['Crew List Departure', 'Funnel Rekap'];
    const directory = await privateDirectory();
    const store = await createStore({ directory, settings: { referenceTabs: references } });
    let broken = false;
    const service = createSyncService({ store, allowFixtureForTests: true,
      loader: async () => broken ? { ...raw, sheets: raw.sheets.filter(sheet => sheet.name !== 'Data Kandidat') } : raw });
    await service.refresh('private-d1-test');
    const first = store.read().snapshot!;
    await service.refresh('private-d1-test');
    const repeated = store.read().snapshot!;
    expect(repeated.counts).toEqual({ candidates: 409, agents: 20, companyRows: 78, companyUniqueIds: 77, companyMissingNames: 2, applications: 612, crewRows: 128, funnelRows: 409 });
    expect(repeated.id).toBe(first.id);
    expect(repeated.applications).toHaveLength(612);
    broken = true;
    await expect(service.refresh('private-d1-test')).rejects.toMatchObject({ status: 503 });
    expect(store.read().snapshot!.id).toBe(repeated.id);
    expect(store.read().sync.state).toBe('failed');
    const file = path.join(directory, 'd1-backup.json');
    await store.backup(file);
    const restoredDirectory = await privateDirectory();
    const restored = await createStore({ directory: restoredDirectory });
    await restored.restore(file);
    const reopened = await createStore({ directory: restoredDirectory });
    expect(reopened.read().snapshot!.counts.applications).toBe(612);
    expect(reopened.read().snapshot!.id).toBe(repeated.id);
    expect(reopened.read().snapshot!.applications.find(row => row.source.row === 597)!.candidateId).toBe('DKDP_014');
    expect(reopened.read().snapshot!.source).toBe('fixture');
  });
});
