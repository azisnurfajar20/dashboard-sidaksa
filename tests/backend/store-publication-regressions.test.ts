import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../../server/store';
import { normalizeWorkbook } from '../../server/domain/normalize';
import { syntheticWorkbook } from '../domain/fixture';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function privateDirectory() {
  const base = path.resolve('.private/test-tmp');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'publication-core-'));
  roots.push(directory);
  return directory;
}
const now = () => new Date('2026-11-10T00:00:00.000Z');
const normalize = (raw: ReturnType<typeof syntheticWorkbook>) => normalizeWorkbook(raw, { referenceTabs: [], mappings: [] });

describe('truthful atomic publication (actual isolated filesystem)', () => {
  it('rejects a failed required archive before changing the active state or success audit', async () => {
    const directory = await privateDirectory(), store = await createStore({ directory, now });
    const rawA = syntheticWorkbook(), snapshotA = normalize(rawA);
    await store.publish(rawA, snapshotA);
    const before = store.read();
    const history = path.join(directory, 'history');
    await rm(history, { recursive: true });
    await writeFile(history, 'SYNTHETIC FILE BLOCKING THE HISTORY DIRECTORY');
    const rawB = { ...syntheticWorkbook(), fetchedAt: '2026-11-10T00:00:00.000Z' }, snapshotB = normalize(rawB);
    await expect(store.publish(rawB, snapshotB)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(store.read()).toEqual(before);
    expect(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))).toEqual(before);
    expect((await createStore({ directory, now })).read()).toEqual(before);
    await rm(history);
    await store.publish(rawB, snapshotB);
    const reopened = await createStore({ directory, now });
    expect(reopened.read().snapshot!.id).toBe(snapshotB.id);
    expect(reopened.read().audit.filter(event => event.action === 'snapshot.publish' && event.result === 'ok')).toHaveLength(2);
    expect(JSON.parse(await readFile(path.join(history, snapshotB.id + '.json'), 'utf8')).snapshot.id).toBe(snapshotB.id);
  });

  it('cannot reject cleanup after already committing the replacement snapshot', async () => {
    const directory = await privateDirectory(), store = await createStore({ directory, now });
    const rawA = syntheticWorkbook(), snapshotA = normalize(rawA);
    await store.publish(rawA, snapshotA);
    const before = store.read();
    const invalidArchive = path.join(directory, 'history', 's_deadbeef.json');
    await mkdir(invalidArchive);
    await writeFile(path.join(invalidArchive, 'synthetic.txt'), 'SYNTHETIC CLEANUP OBSTRUCTION');
    const expired = new Date('2020-01-01T00:00:00.000Z');
    await utimes(invalidArchive, expired, expired);
    const rawB = { ...syntheticWorkbook(), fetchedAt: '2026-11-10T00:00:00.000Z' }, snapshotB = normalize(rawB);
    await expect(store.publish(rawB, snapshotB)).rejects.toThrow();
    expect(store.read()).toEqual(before);
    expect((await createStore({ directory, now })).read()).toEqual(before);
    const backup = path.join(directory, 'still-active.json');
    await store.backup(backup);
    expect(JSON.parse(await readFile(backup, 'utf8')).state.snapshot.id).toBe(snapshotA.id);
    await rm(invalidArchive, { recursive: true });
    await store.publish(rawB, snapshotB);
    expect((await createStore({ directory, now })).read().snapshot!.id).toBe(snapshotB.id);
  });

  it('archives the mappings serialized with each publication and restores their canonical backup', async () => {
    const directory = await privateDirectory(), store = await createStore({ directory, now });
    const rawA = syntheticWorkbook(), snapshotA = normalize(rawA);
    const mappings = [{ id: 'm-queued', kind: 'agent' as const, alias: 'Approved alias', targetId: 'AG_1',
      reason: 'Synthetic serialization regression', createdAt: '2026-11-10T00:00:00.000Z', createdBy: 'test' }];
    const mappedA = normalizeWorkbook(rawA, { referenceTabs: [], mappings });
    const rawB = { ...syntheticWorkbook(), fetchedAt: '2026-11-10T00:00:00.000Z' };
    const snapshotB = normalizeWorkbook(rawB, { referenceTabs: [], mappings });
    const first = store.publish(rawA, snapshotA);
    const changed = store.update(state => { state.mappings = mappings; state.raw = rawA; state.snapshot = mappedA; });
    const second = store.publish(rawB, snapshotB);
    await Promise.all([first, changed, second]);
    for (const [snapshot, expectedMappings] of [[snapshotA, []], [snapshotB, mappings]] as const) {
      const archive = JSON.parse(await readFile(path.join(directory, 'history', snapshot.id + '.json'), 'utf8'));
      expect(archive.mappings).toEqual(expectedMappings);
      expect(normalizeWorkbook(archive.raw, { referenceTabs: [], mappings: archive.mappings })).toEqual(archive.snapshot);
    }
    expect((await createStore({ directory, now })).read().snapshot).toEqual(snapshotB);
    const backup = path.join(directory, 'mapped-backup.json');
    await store.backup(backup);
    await store.update(state => { state.raw = null; state.snapshot = null; state.mappings = []; });
    await store.restore(backup);
    const restored = (await createStore({ directory, now })).read();
    expect(restored.snapshot).toEqual(snapshotB);
    expect(restored.mappings).toEqual(mappings);
  });
});
