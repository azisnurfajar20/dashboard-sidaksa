import { randomUUID } from 'node:crypto';
import type { SyncState } from '../shared/contracts.js';
import { ApiError } from './auth.js';
import { normalizeWorkbook } from './domain/normalize.js';
import type { SourceLoader } from './google.js';
import { assertMappingSource, rawWorkbookSchema, type Store } from './store.js';

export interface SyncService {
  refresh(actor?: string): Promise<SyncState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  idle(): Promise<void>;
  reschedule(): Promise<void>;
}
export interface SyncOptions {
  store: Store;
  loader: SourceLoader;
  now?: () => Date;
  /** Trusted isolated tests only; never derived from HTTP or environment. */
  allowFixtureForTests?: boolean;
}

export function createSyncService(options: SyncOptions): SyncService {
  const { store, loader } = options;
  const now = options.now || (() => new Date());
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<SyncState> | undefined;
  let starting: Promise<void> | undefined;
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  async function schedule() {
    clearTimer();
    if (!active) return;
    const delay = store.read().settings.syncIntervalMinutes * 60000;
    const nextRunAt = new Date(now().getTime() + delay).toISOString();
    await store.update(s => { s.sync.nextRunAt = nextRunAt; });
    if (!active) return;
    timer = setTimeout(() => { timer = undefined; void service.refresh('scheduler').catch(() => {}); }, delay);
    timer.unref?.();
  }
  const service: SyncService = {
    refresh(actor = 'scheduler') {
      if (pending) return Promise.reject(new ApiError(409, 'SYNC_RUNNING', 'Sinkronisasi sedang berjalan.'));
      clearTimer();
      const run = async (): Promise<SyncState> => {
        await store.update(s => { s.sync = { ...s.sync, state: 'running', lastAttemptAt: now().toISOString(), nextRunAt: null, message: null }; });
        try {
          const state = store.read();
          const raw = rawWorkbookSchema.parse(await loader([...state.settings.referenceTabs]));
          if (raw.source !== 'google-sheets' && !options.allowFixtureForTests) throw new Error('Source mode rejected');
          assertMappingSource(state, raw);
          const snapshot = normalizeWorkbook(raw, { referenceTabs: state.settings.referenceTabs, mappings: state.mappings });
          await store.publish(raw, snapshot, actor);
        } catch (error) {
          const unconfigured = error instanceof ApiError && error.code === 'SHEETS_UNCONFIGURED';
          const sourceMismatch = error instanceof ApiError && error.code === 'MAPPING_SOURCE_MISMATCH' ? error : null;
          const code = unconfigured ? 'SHEETS_UNCONFIGURED' : sourceMismatch ? 'MAPPING_SOURCE_MISMATCH' : 'SYNC_FAILED';
          const message = unconfigured ? 'Google Sheets belum dikonfigurasi.' : sourceMismatch?.message || 'Sinkronisasi Google Sheets gagal. Snapshot terakhir tetap dipertahankan.';
          await store.update(s => {
            s.sync = { ...s.sync, state: 'failed', message };
            s.audit.push({ id: randomUUID(), at: now().toISOString(), actorId: actor, action: 'sync.refresh', result: 'failed', details: { code } });
          });
          throw new ApiError(503, code, message);
        }
        return store.read().sync;
      };
      const task = run().finally(async () => { pending = undefined; await schedule(); });
      pending = task;
      return task.then(() => store.read().sync);
    },
    start() {
      if (starting) return starting;
      if (active) return Promise.resolve();
      active = true;
      starting = (async () => { try { await service.refresh('scheduler'); } catch { /* Failure is persisted; boot remains available. */ } })().finally(() => { starting = undefined; });
      return starting;
    },
    async stop() {
      active = false;
      clearTimer();
      await service.idle();
      await store.update(s => { s.sync.nextRunAt = null; });
    },
    async idle() { if (pending) await pending.catch(() => {}); },
    async reschedule() { if (!pending) await schedule(); },
  };
  return service;
}
