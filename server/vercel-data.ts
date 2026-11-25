
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApp } from './app.js';
import { ApiError, type Authenticator } from './auth.js';
import { readConfig, type Config } from './config.js';
import { createGoogleSource, type SourceLoader } from './google.js';
import type { Store } from './store.js';
import { createSyncService } from './sync.js';

import {
  createPrivateBlob as createSheetsStore,
  openVercelStore,
  privateBlobCredentials as sheetsStoreCredentials,
  type PrivateBlob as SheetsStore,
} from './vercel-store.js';

import {
  dataRoutes,
  routeKey,
  idKey,
  dataEntry as entry,
} from '../shared/vercel-routes.js';

type Handler = (
  req: IncomingMessage,
  res: ServerResponse
) => void | Promise<void>;

function fail(res: ServerResponse, error: unknown) {
  const e =
    error instanceof ApiError
      ? error
      : new ApiError(
          503,
          'HOSTED_DATA_UNCONFIGURED',
          'API data SIDAKSA belum dikonfigurasi dengan benar.'
        );

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  res.statusCode = e.status;

  res.end(
    JSON.stringify({
      error: {
        code: e.code,
        message: e.message,
      },
    })
  );
}

export function resolveDataRequest(url: string) {
  if (!url.startsWith('/api/') || url.length > 8192) {
    return null;
  }

  const query = url.indexOf('?');

  const pathname =
    query < 0 ? url : url.slice(0, query);

  const search =
    query < 0 ? '' : url.slice(query + 1);

  const pairs = search.split('&');
  const params = new URLSearchParams(search);

  const hasRouting =
    params.has(routeKey) || params.has(idKey);

  const accepted = (p: string) =>
    dataRoutes.some(route =>
      new RegExp(
        `^/api/${route.replace(':id', '[^/?#\\\\]+')}/?$`
      ).test(p)
    );

  if (pathname !== entry) {
    if (!accepted(pathname)) return null;
    if (!hasRouting) return url;
  }

  const routes = params.getAll(routeKey);
  const ids = params.getAll(idKey);

  const route = dataRoutes[Number(routes[0])];

  if (
    routes.length !== 1 ||
    !/^(0|[1-9][0-9]?)$/.test(routes[0]!) ||
    !route
  ) {
    return null;
  }

  let resolved = `/api/${route}`;

  if (route.includes(':id')) {
    if (
      ids.length !== 1 ||
      !ids[0] ||
      ids[0].length > 200 ||
      /[\u0000-\u001f\u007f]/.test(ids[0])
    ) {
      return null;
    }

    resolved = resolved.replace(
      ':id',
      () => encodeURIComponent(ids[0]!)
    );
  } else if (ids.length) {
    return null;
  }

  if (
    pathname !== entry &&
    pathname !== resolved &&
    pathname !== `${resolved}/`
  ) {
    return null;
  }

  const remaining = pairs
    .filter(pair => {
      const key =
        new URLSearchParams(pair).keys().next().value;

      return key !== routeKey && key !== idKey;
    })
    .join('&');

  return remaining
    ? `${resolved}?${remaining}`
    : resolved;
}

export interface VercelDataOptions {
  config: Config;

  // Nama properti dipertahankan untuk kompatibilitas.
  // Implementasinya sekarang menggunakan Google Sheets.
  blob: SheetsStore;

  loader: SourceLoader;
  authenticate?: Authenticator;
  now?: () => Date;
  scope?: 'test' | 'production' | 'preview';
  cronSecret?: string;
  vercelProxy?: boolean;
}

export async function createVercelDataHandler(
  options: VercelDataOptions
): Promise<Handler> {
  const {
    config,
    blob: sheetsStore,
    scope,
    loader,
    authenticate,
    cronSecret,
    vercelProxy,
  } = options;

  const now = options.now ?? (() => new Date());

  const open = () =>
    openVercelStore({
      blob: sheetsStore,
      config,
      now,
      scope,
    });

  const active = new AsyncLocalStorage<Store>();

  const current = () => {
    const store = active.getStore();

    if (!store) {
      throw new ApiError(
        503,
        'STORE_UNAVAILABLE',
        'Penyimpanan Google Sheets SIDAKSA belum tersedia.'
      );
    }

    return store;
  };

  const store: Store = {
    directory: '',

    read: () => current().read(),

    update: fn => current().update(fn),

    publish: (...args) =>
      current().publish(...args),

    backup: p => current().backup(p),

    restore: p => current().restore(p),
  };

  // Penguncian penulis harus dijamin oleh adapter
  // Google Sheets melalui Apps Script.
  const forRequest = () =>
    createSyncService({
      store: current(),
      loader,
      now,
    });

  const app = await createApp({
    config,
    store,
    now,

    authenticator: authenticate,

    hostedData: cronSecret
      ? 'vercel-cron'
      : 'manual',

    vercelProxy,

    prepareDataRequest: async (_req, _res, next) =>
      active.run(await open(), next),

    sync: {
      refresh: actor =>
        forRequest().refresh(actor),

      start: async () => {},
      stop: async () => {},
      idle: async () => {},
      reschedule: async () => {},
    },
  });

  const secretDigest = (value: string) =>
    createHash('sha256')
      .update(value)
      .digest();

  const cronProof = cronSecret
    ? secretDigest(`Bearer ${cronSecret}`)
    : null;

  return async (req, res) => {
    if (req.url === '/api/sidaksa-cron') {
      if (!cronProof || req.method !== 'GET') {
        fail(
          res,
          new ApiError(
            404,
            'NOT_FOUND',
            'Endpoint tidak ditemukan.'
          )
        );

        return;
      }

      if (
        !req.headers.authorization ||
        !timingSafeEqual(
          cronProof,
          secretDigest(req.headers.authorization)
        )
      ) {
        fail(
          res,
          new ApiError(
            401,
            'AUTH_REQUIRED',
            'Otorisasi penjadwal diperlukan.'
          )
        );

        return;
      }

      try {
        const state = await open();

        const {
          sync,
          settings,
          snapshot,
        } = state.read();

        const elapsed =
          now().getTime() -
          Date.parse(sync.lastSuccessAt || '');

        if (
          !snapshot ||
          snapshot.spreadsheetId !==
            config.spreadsheetId ||
          !Number.isFinite(elapsed) ||
          elapsed >=
            settings.syncIntervalMinutes * 60_000
        ) {
          await createSyncService({
            store: state,
            loader,
            now,
          }).refresh('scheduler');
        }

        res.setHeader(
          'Cache-Control',
          'private, no-store'
        );

        res.statusCode = 204;
        res.end();
      } catch (error) {
        fail(res, error);
      }

      return;
    }

    let path: string | null;

    try {
      path = resolveDataRequest(req.url || '');
    } catch {
      path = null;
    }

    if (!path) {
      fail(
        res,
        new ApiError(
          404,
          'NOT_FOUND',
          'Endpoint tidak ditemukan.'
        )
      );

      return;
    }

    req.url = path;

    for (const key of [
      'query',
      'body',
      'cookies',
    ] as const) {
      if (
        Object.getOwnPropertyDescriptor(
          req,
          key
        )?.configurable
      ) {
        Reflect.deleteProperty(req, key);
      }
    }

    app(req, res);
  };
}

let production: Promise<Handler> | undefined;

async function makeRuntimeHandler(
  env: NodeJS.ProcessEnv
) {
  const preview =
    env.VERCEL_ENV !== 'production';

  const appOrigin =
    env.SIDAKSA_WEB_ORIGIN?.trim() ||
    (
      preview && env.VERCEL_URL
        ? `https://${env.VERCEL_URL}`
        : 'https://dashboard-sidaksa.vercel.app'
    );

  if (!appOrigin.startsWith('https://')) {
    throw new ApiError(
      503,
      'HOSTED_DATA_UNCONFIGURED',
      'Origin frontend Vercel harus menggunakan HTTPS.'
    );
  }

  const config = readConfig({
    ...env,
    APP_ORIGIN: appOrigin,
    HOST: undefined,
    PORT: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    GOOGLE_USE_ADC: 'false',
    SIDAKSA_DATA_DIR: undefined,
  });

  const serviceAccountJson =
    env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  config.credentialConfigured =
    Boolean(serviceAccountJson);

  config.sheetsConfigured = Boolean(
    config.spreadsheetId &&
    config.credentialConfigured
  );

  // Validasi sumber Google Sheets utama.
  if (!config.sheetsConfigured) {
    throw new ApiError(
      503,
      'SHEETS_UNCONFIGURED',
      'Spreadsheet ID atau kredensial Google Sheets belum dikonfigurasi.'
    );
  }

  // Penyimpanan internal berbasis Google Sheets.
  // Tidak membutuhkan Vercel Blob.
  const credentials =
    sheetsStoreCredentials(env, preview);

  if (!credentials) {
    throw new ApiError(
      503,
      'HOSTED_DATA_UNCONFIGURED',
      'URL atau secret Google Sheets Store belum dikonfigurasi.'
    );
  }

  const sheetsStore =
    createSheetsStore(credentials);

  const cronSecret =
    !preview &&
    env.SIDAKSA_CRON_ENABLED === 'true' &&
    (env.CRON_SECRET?.length ?? 0) >= 24
      ? env.CRON_SECRET
      : undefined;

  return createVercelDataHandler({
    config,

    // Nama properti lama dipertahankan
    // agar kompatibel dengan pengujian backend.
    blob: sheetsStore,

    loader: createGoogleSource(config, {
      serviceAccountJson,
    }),

    scope: preview
      ? 'preview'
      : 'production',

    cronSecret,

    vercelProxy: env.VERCEL === '1',
  });
}

export async function vercelData(
  req: IncomingMessage,
  res: ServerResponse
) {
  try {
    production ??=
      makeRuntimeHandler(process.env)
        .catch(error => {
          production = undefined;
          throw error;
        });

    await (await production)(req, res);
  } catch (error) {
    if (!res.headersSent) {
      fail(res, error);
    } else {
      res.destroy();
    }
  }
}
