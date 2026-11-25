import { randomUUID } from 'node:crypto';
import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob';
import { ApiError } from './auth.js';
import type { Config } from './config.js';
import { normalizeWorkbook } from './domain/normalize.js';
import { assertMappingSource, emptyStoredState, validateStoredState, type Store } from './store.js';

const maxBytes = 24 * 1024 * 1024;
// Longer than the function duration: a timed-out invocation cannot retain this lease forever.
export const syncLeaseMs = 90_000;
const unavailable = () => new ApiError(503, 'STORE_UNAVAILABLE', 'Penyimpanan privat SIDAKSA di Vercel tidak tersedia.');
const conflict = () => new ApiError(409, 'STORE_CONFLICT', 'Data berubah bersamaan. Muat ulang sebelum mencoba lagi.');
const busy = () => new ApiError(409, 'SYNC_RUNNING', 'Sinkronisasi sedang berjalan.');

export interface PrivateBlob {
  read(key: string): Promise<{ value: string; etag: string } | null>;
  write(key: string, value: string, expected: string | null): Promise<string | null>;
  prune(prefix: string, cutoff: number): Promise<void>;
}

async function readBounded(stream: ReadableStream<Uint8Array>, size: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (size > maxBytes) throw unavailable();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw unavailable();
      chunks.push(part.value);
    }
    if (bytes === 0) throw unavailable();
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function privateBlobCredentials(env: NodeJS.ProcessEnv, preview: boolean) {
  const storeId = (preview ? env.SIDAKSA_PREVIEW_BLOB_STORE_ID : env.BLOB_STORE_ID)?.trim();
  const token = (preview ? env.SIDAKSA_PREVIEW_BLOB_READ_WRITE_TOKEN : env.BLOB_READ_WRITE_TOKEN)?.trim();
  return storeId ? { storeId } : token ? { token } : null;
}

export function createPrivateBlob(credentials: ReturnType<typeof privateBlobCredentials>): PrivateBlob {
  async function read(key: string) {
    if (!credentials) throw unavailable();
    try {
      const result = await get(key, { ...credentials, access: 'private', useCache: false, abortSignal: AbortSignal.timeout(10_000) });
      if (!result) return null;
      if (result.statusCode !== 200) throw unavailable();
      if (!result.blob.etag || result.blob.pathname !== key) {
        await result.stream.cancel().catch(() => {});
        throw unavailable();
      }
      return { value: await readBounded(result.stream, result.blob.size), etag: result.blob.etag };
    } catch { throw unavailable(); }
  }
  return {
    read,
    async write(key, value, expected) {
      if (!credentials || Buffer.byteLength(value, 'utf8') > maxBytes) throw unavailable();
      try {
        const result = await put(key, value, {
          ...credentials, access: 'private', abortSignal: AbortSignal.timeout(12_000), contentType: 'application/json',
          addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: expected !== null,
          ...(expected === null ? {} : { ifMatch: expected }),
        });
        if (!result.etag || result.pathname !== key) throw unavailable();
        return result.etag;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        // The SDK may report a separate failure for no-overwrite first creation.
        if (expected === null && await read(key).catch(() => null)) return null;
        throw unavailable();
      }
    },
    async prune(prefix, cutoff) {
      if (!credentials) throw unavailable();
      // Best-effort and time-bounded. Active state is outside the immutable history prefix.
      const deadline = AbortSignal.timeout(3_000);
      let cursor: string | undefined;
      do {
        const result = await list({ ...credentials, prefix, cursor, limit: 100, abortSignal: deadline });
        const expired = result.blobs.filter(blob => blob.pathname.startsWith(prefix)
          && /^s_[a-f0-9]{24}-[a-f0-9-]{36}\.json$/.test(blob.pathname.slice(prefix.length))
          && blob.uploadedAt.getTime() < cutoff);
        if (expired.length) await del(expired.map(blob => blob.pathname), { ...credentials, abortSignal: deadline });
        if (!result.hasMore || !result.cursor || result.cursor === cursor) break;
        cursor = result.cursor;
      } while (!deadline.aborted);
    },
  };
}

export async function openVercelStore({ blob, config, now = () => new Date(), scope = 'test' }: {
  blob: PrivateBlob; config: Config; now?: () => Date; scope?: 'test' | 'production' | 'preview';
}): Promise<Store> {
  const prefix = `sidaksa/v1/${scope}/`, key = `${prefix}state.json`;
  const saved = await blob.read(key);
  let etag = saved?.etag ?? null;
  let ownsSync = false;
  const defaults = { referenceTabs: config.referenceTabs, syncIntervalMinutes: config.syncIntervalMinutes, retentionDays: config.retentionDays };
  let current = emptyStoredState(defaults);
  if (saved) {
    try { current = validateStoredState(JSON.parse(saved.value)); }
    catch { throw new ApiError(503, 'STORE_INVALID', 'Penyimpanan privat tidak valid; pemulihan diperlukan.'); }
  }
  const attemptAt = Date.parse(current.sync.lastAttemptAt || '');
  if (current.sync.state === 'running' && (!Number.isFinite(attemptAt) || now().getTime() - attemptAt >= syncLeaseMs)) {
    current.sync = { ...current.sync, state: 'failed', message: 'Percobaan sinkronisasi terhenti. Jalankan kembali dari Pengaturan.' };
  }
  const update = async (mutate: Parameters<Store['update']>[0]) => {
    if (current.sync.state === 'running' && !ownsSync) throw busy();
    const next = structuredClone(current);
    await mutate(next);
    const checked = validateStoredState(next);
    const fresh = await blob.write(key, JSON.stringify(checked), etag);
    if (!fresh) throw conflict();
    ownsSync = checked.sync.state === 'running' && (ownsSync || current.sync.state !== 'running');
    current = checked;
    etag = fresh;
  };
  return {
    directory: '', read: () => structuredClone(current), update,
    async publish(raw, snapshot, actor = 'scheduler') {
      if (!ownsSync) throw busy();
      assertMappingSource(current, raw);
      const canonical = normalizeWorkbook(raw, { referenceTabs: snapshot.referenceStats.approvedReferenceTabs, mappings: current.mappings });
      if (JSON.stringify(canonical) !== JSON.stringify(snapshot)) throw unavailable();
      const history = `${prefix}history/`;
      const archive = `${history}${snapshot.id}-${randomUUID()}.json`;
      if (!await blob.write(archive, JSON.stringify({ version: 1, raw, snapshot, mappings: current.mappings }), null)) throw conflict();
      const at = now(), cutoff = at.getTime() - current.settings.retentionDays * 86_400_000;
      await update(state => {
        state.raw = raw; state.snapshot = snapshot;
        state.sync = { ...state.sync, state: 'ok', lastSuccessAt: snapshot.createdAt, message: null };
        state.audit.push({ id: randomUUID(), at: at.toISOString(), actorId: actor, action: 'snapshot.publish', result: 'ok', details: { snapshotId: snapshot.id, applications: snapshot.counts.applications, source: snapshot.source } });
        state.audit = state.audit.filter(event => Date.parse(event.at) >= cutoff);
        state.reviews = state.reviews.filter(event => Date.parse(event.at) >= cutoff);
      });
      await blob.prune(history, cutoff).catch(() => {});
    },
    async backup() { throw new ApiError(405, 'BACKUP_LOCAL_ONLY', 'CLI backup hanya berlaku untuk penyimpanan lokal.'); },
    async restore() { throw new ApiError(405, 'RESTORE_LOCAL_ONLY', 'CLI restore hanya berlaku untuk penyimpanan lokal.'); },
  };
}
