
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { PublicConfig } from '../shared/contracts.js';

export interface Config {
  host: string;
  port: number;
  appOrigin: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  authConfigured: boolean;
  googleOAuthEnabled: boolean;
  spreadsheetId: string;
  credentialFile: string;
  useAdc: boolean;
  credentialConfigured: boolean;
  sheetsConfigured: boolean;
  referenceTabs: string[];
  syncIntervalMinutes: number;
  retentionDays: number;
  dataDir: string;
}

type AuthConfig = Pick<
  Config,
  | 'authConfigured'
  | 'supabaseUrl'
  | 'supabasePublishableKey'
  | 'googleOAuthEnabled'
>;

export function readAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): AuthConfig {
  const supabaseUrl =
    env.SUPABASE_URL?.trim() || '';

  const supabasePublishableKey =
    env.SUPABASE_PUBLISHABLE_KEY?.trim() || '';

  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);

      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      ) {
        throw new Error();
      }
    } catch {
      throw new Error('SUPABASE_URL tidak valid');
    }
  }

  if (
    supabasePublishableKey &&
    !supabasePublishableKey.startsWith(
      'sb_publishable_'
    )
  ) {
    try {
      const parts =
        supabasePublishableKey.split('.');

      if (
        parts.length !== 3 ||
        JSON.parse(
          Buffer.from(
            parts[1]!,
            'base64url'
          ).toString()
        ).role !== 'anon'
      ) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'Gunakan publishable key Supabase, bukan secret/service key'
      );
    }
  }

  return {
    supabaseUrl,
    supabasePublishableKey,

    authConfigured: Boolean(
      supabaseUrl &&
      supabasePublishableKey
    ),

    googleOAuthEnabled:
      env.AUTH_GOOGLE_ENABLED === 'true',
  };
}

export function readConfig(
  env: NodeJS.ProcessEnv = process.env
): Config {
  const host =
    env.HOST?.trim() || '127.0.0.1';

  const number = (
    key: string,
    def: number,
    min: number,
    max: number
  ) => {
    const n = env[key]?.trim()
      ? Number(env[key])
      : def;

    if (
      !Number.isInteger(n) ||
      n < min ||
      n > max
    ) {
      throw new Error(
        `Konfigurasi ${key} tidak valid`
      );
    }

    return n;
  };

  const port = number(
    'PORT',
    3080,
    1,
    65535
  );

  const appOrigin =
    env.APP_ORIGIN?.trim() ||
    `http://${host}:${port}`;

  try {
    const u = new URL(appOrigin);

    if (
      !['http:', 'https:'].includes(
        u.protocol
      ) ||
      u.origin !== appOrigin
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'APP_ORIGIN tidak valid'
    );
  }

  const auth = readAuthConfig(env);

  // Konfigurasi tab referensi Google Sheets.
  let referenceTabs: string[] = [];

  try {
    referenceTabs = z
      .array(
        z.enum([
          'Crew List Departure',
          'Funnel Rekap',
        ])
      )
      .max(2)
      .parse(
        JSON.parse(
          env.GOOGLE_REFERENCE_TABS || '[]'
        )
      );

    if (
      new Set(referenceTabs).size !==
      referenceTabs.length
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'GOOGLE_REFERENCE_TABS tidak valid'
    );
  }

  // Spreadsheet utama SIDAKSA.
  const spreadsheetId =
    env.GOOGLE_SPREADSHEET_ID?.trim() || '';

  if (
    spreadsheetId &&
    !/^[A-Za-z0-9_-]{10,200}$/.test(
      spreadsheetId
    )
  ) {
    throw new Error(
      'GOOGLE_SPREADSHEET_ID tidak valid'
    );
  }

  // Kredensial lokal.
  const credentialFile =
    env.GOOGLE_APPLICATION_CREDENTIALS
      ?.trim() || '';

  const useAdc =
    env.GOOGLE_USE_ADC === 'true';

  // Kredensial Google Sheets untuk Vercel.
  const serviceAccountJson =
    env.GOOGLE_SERVICE_ACCOUNT_JSON
      ?.trim() || '';

  let jsonCredentialConfigured = false;

  if (serviceAccountJson) {
    try {
      const credentials = JSON.parse(
        serviceAccountJson
      );

      if (
        credentials.type !==
          'service_account' ||
        typeof credentials.client_email !==
          'string' ||
        !credentials.client_email.trim() ||
        typeof credentials.private_key !==
          'string' ||
        !credentials.private_key.trim()
      ) {
        throw new Error();
      }

      jsonCredentialConfigured = true;
    } catch {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_JSON tidak valid'
      );
    }
  }

  // Vercel menggunakan JSON dari environment.
  // File lokal dan ADC hanya untuk runtime lokal.
  const isVercel = env.VERCEL === '1';

  const credentialConfigured = isVercel
    ? jsonCredentialConfigured
    : Boolean(
        (credentialFile &&
          existsSync(credentialFile)) ||
        useAdc
      );

  const sheetsConfigured = Boolean(
    spreadsheetId &&
    credentialConfigured
  );

  return {
    host,
    port,
    appOrigin,

    ...auth,

    spreadsheetId,
    credentialFile,
    useAdc,
    credentialConfigured,
    sheetsConfigured,
    referenceTabs,

    syncIntervalMinutes: number(
      'SYNC_INTERVAL_MINUTES',
      15,
      1,
      1440
    ),

    retentionDays: number(
      'SNAPSHOT_RETENTION_DAYS',
      30,
      1,
      365
    ),

    // Tetap dipertahankan untuk runtime lokal.
    dataDir: path.resolve(
      env.SIDAKSA_DATA_DIR ||
      '.private/data'
    ),
  };
}

export function publicConfig(
  c: AuthConfig
): PublicConfig {
  return {
    appName: 'SIDAKSA',

    authConfigured:
      c.authConfigured,

    supabaseUrl:
      c.authConfigured
        ? c.supabaseUrl
        : null,

    supabasePublishableKey:
      c.authConfigured
        ? c.supabasePublishableKey
        : null,

    googleOAuthEnabled:
      c.googleOAuthEnabled,
  };
}
