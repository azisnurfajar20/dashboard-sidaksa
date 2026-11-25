
import { randomUUID } from 'node:crypto';
import { ApiError } from './auth.js';
import type { Config } from './config.js';
import { normalizeWorkbook } from './domain/normalize.js';
import {
  assertMappingSource,
  emptyStoredState,
  validateStoredState,
  type Store,
} from './store.js';

const maxBytes = 24 * 1024 * 1024;

export const syncLeaseMs = 90_000;

const unavailable = () =>
  new ApiError(
    503,
    'STORE_UNAVAILABLE',
    'Penyimpanan Google Sheets SIDAKSA tidak tersedia.'
  );

const conflict = () =>
  new ApiError(
    409,
    'STORE_CONFLICT',
    'Data berubah bersamaan. Muat ulang sebelum mencoba lagi.'
  );

const busy = () =>
  new ApiError(
    409,
    'SYNC_RUNNING',
    'Sinkronisasi sedang berjalan.'
  );

export interface PrivateBlob {
  read(
    key: string
  ): Promise<{ value: string; etag: string } | null>;

  write(
    key: string,
    value: string,
    expected: string | null
  ): Promise<string | null>;

  prune(
    prefix: string,
    cutoff: number
  ): Promise<void>;
}

interface SheetsCredentials {
  url: string;
  secret: string;
}

interface SheetsResponse {
  ok: boolean;
  code?: string;
  value?: string;
  etag?: string;
}

// Nama dipertahankan untuk kompatibilitas.
// Tidak lagi menggunakan kredensial Vercel Blob.
export function privateBlobCredentials(
  env: NodeJS.ProcessEnv,
  preview: boolean
): SheetsCredentials | null {
  const url = (
    preview
      ? env.SIDAKSA_PREVIEW_SHEETS_STORE_URL
      : env.SIDAKSA_SHEETS_STORE_URL
  )?.trim();

  const secret = (
    preview
      ? env.SIDAKSA_PREVIEW_SHEETS_STORE_SECRET
      : env.SIDAKSA_SHEETS_STORE_SECRET
  )?.trim();

  if (!url || !secret) return null;

  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'script.google.com' ||
      !parsed.pathname.endsWith('/exec')
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { url, secret };
}

// Adapter Google Sheets melalui Google Apps Script.
export function createPrivateBlob(
  credentials: ReturnType<typeof privateBlobCredentials>
): PrivateBlob {
  async function request(
    operation: string,
    payload: Record<string, unknown>
  ): Promise<SheetsResponse> {
    if (!credentials) throw unavailable();

    try {
      const response = await fetch(credentials.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation,
          ...payload,
          secret: credentials.secret,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });

      if (!response.ok) throw unavailable();

      const result =
        (await response.json()) as SheetsResponse;

      if (
        !result ||
        typeof result.ok !== 'boolean'
      ) {
        throw unavailable();
      }

      return result;
    } catch {
      throw unavailable();
    }
  }

  return {
    async read(key) {
      const result = await request('read', { key });

      if (!result.ok) {
        if (result.code === 'NOT_FOUND') return null;
        throw unavailable();
      }

      if (
        typeof result.value !== 'string' ||
        typeof result.etag !== 'string' ||
        !result.etag ||
        Buffer.byteLength(result.value, 'utf8') > maxBytes
      ) {
        throw unavailable();
      }

      return {
        value: result.value,
        etag: result.etag,
      };
    },

    async write(key, value, expected) {
      if (
        Buffer.byteLength(value, 'utf8') > maxBytes
      ) {
        throw unavailable();
      }

      const result = await request('write', {
        key,
        value,
        expected,
      });

      if (!result.ok) {
        if (result.code === 'CONFLICT') return null;
        throw unavailable();
      }

      if (
        typeof result.etag !== 'string' ||
        !result.etag
      ) {
        throw unavailable();
      }

      return result.etag;
    },

    async prune(prefix, cutoff) {
      const result = await request('prune', {
        prefix,
        cutoff,
      });

      if (!result.ok) throw unavailable();
    },
  };
}

export async function openVercelStore({
  blob,
  config,
  now = () => new Date(),
  scope = 'test',
}: {
  blob: PrivateBlob;
  config: Config;
  now?: () => Date;
  scope?: 'test' | 'production' | 'preview';
}): Promise<Store> {
  const prefix = `sidaksa/v1/${scope}/`;
  const key = `${prefix}state.json`;

  const saved = await blob.read(key);

  let etag = saved?.etag ?? null;
  let ownsSync = false;

  const defaults = {
    referenceTabs: config.referenceTabs,
    syncIntervalMinutes: config.syncIntervalMinutes,
    retentionDays: config.retentionDays,
  };

  let current = emptyStoredState(defaults);

  if (saved) {
    try {
      current = validateStoredState(
        JSON.parse(saved.value)
      );
    } catch {
      throw new ApiError(
        503,
        'STORE_INVALID',
        'Penyimpanan Google Sheets tidak valid; pemulihan diperlukan.'
      );
    }
  }

  const attemptAt = Date.parse(
    current.sync.lastAttemptAt || ''
  );

  if (
    current.sync.state === 'running' &&
    (
      !Number.isFinite(attemptAt) ||
      now().getTime() - attemptAt >= syncLeaseMs
    )
  ) {
    current.sync = {
      ...current.sync,
      state: 'failed',
      message:
        'Percobaan sinkronisasi terhenti. Jalankan kembali dari Pengaturan.',
    };
  }

  const update = async (
    mutate: Parameters<Store['update']>[0]
  ) => {
    if (
      current.sync.state === 'running' &&
      !ownsSync
    ) {
      throw busy();
    }

    const next = structuredClone(current);

    await mutate(next);

    const checked = validateStoredState(next);

    const fresh = await blob.write(
      key,
      JSON.stringify(checked),
      etag
    );

    if (!fresh) throw conflict();

    ownsSync =
      checked.sync.state === 'running' &&
      (
        ownsSync ||
        current.sync.state !== 'running'
      );

    current = checked;
    etag = fresh;
  };

  return {
    directory: '',

    read: () => structuredClone(current),

    update,

    async publish(
      raw,
      snapshot,
      actor = 'scheduler'
    ) {
      if (!ownsSync) throw busy();

      assertMappingSource(current, raw);

      const canonical = normalizeWorkbook(raw, {
        referenceTabs:
          snapshot.referenceStats.approvedReferenceTabs,
        mappings: current.mappings,
      });

      if (
        JSON.stringify(canonical) !==
        JSON.stringify(snapshot)
      ) {
        throw unavailable();
      }

      const history = `${prefix}history/`;

      const archive =
        `${history}${snapshot.id}-${randomUUID()}.json`;

      const archived = await blob.write(
        archive,
        JSON.stringify({
          version: 1,
          raw,
          snapshot,
          mappings: current.mappings,
        }),
        null
      );

      if (!archived) throw conflict();

      const at = now();

      const cutoff =
        at.getTime() -
        current.settings.retentionDays * 86_400_000;

      await update(state => {
        state.raw = raw;
        state.snapshot = snapshot;

        state.sync = {
          ...state.sync,
          state: 'ok',
          lastSuccessAt: snapshot.createdAt,
          message: null,
        };

        state.audit.push({
          id: randomUUID(),
          at: at.toISOString(),
          actorId: actor,
          action: 'snapshot.publish',
          result: 'ok',
          details: {
            snapshotId: snapshot.id,
            applications: snapshot.counts.applications,
            source: snapshot.source,
          },
        });

        state.audit = state.audit.filter(
          event => Date.parse(event.at) >= cutoff
        );

        state.reviews = state.reviews.filter(
          event => Date.parse(event.at) >= cutoff
        );
      });

      await blob.prune(history, cutoff).catch(() => {});
    },

    async backup() {
      throw new ApiError(
        405,
        'BACKUP_LOCAL_ONLY',
        'CLI backup hanya berlaku untuk penyimpanan lokal.'
      );
    },

    async restore() {
      throw new ApiError(
        405,
        'RESTORE_LOCAL_ONLY',
        'CLI restore hanya berlaku untuk penyimpanan lokal.'
      );
    },
  };
}
