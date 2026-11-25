import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleAuth, JWT } from 'google-auth-library';
import { createGoogleSource, READ_ONLY_SCOPE } from '../../server/google';
import { readConfig } from '../../server/config';

const base = path.resolve('.private/test-tmp');
const roots: string[] = [];
const rsa = (bits: number) => generateKeyPairSync('rsa', { modulusLength: bits, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const credentials = { type: 'service_account', project_id: 'synthetic-auth-only', client_email: 'synthetic@synthetic-auth-only.iam.gserviceaccount.com', private_key: rsa(2048),
  // Deliberately untrusted optional fields must never select another token endpoint/provider.
  token_uri: 'https://untrusted.invalid/token', universe_domain: 'untrusted.invalid',
  credential_source: { executable: { command: 'SYNTHETIC_DO_NOT_EXECUTE' } } };
const names = ['Data Kandidat', 'Data Mitra Agent', 'Data Company', 'Proses Rekrutment'];

afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function configured(contents: unknown = credentials) {
  await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'google-auth-')); roots.push(dir);
  const file = path.join(dir, 'synthetic-service-account.json');
  await writeFile(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return { file, config: readConfig({ GOOGLE_SPREADSHEET_ID: 'SYNTHETIC_AUTH_ONLY', GOOGLE_APPLICATION_CREDENTIALS: file, GOOGLE_USE_ADC: 'false' }) };
}
function fakeSheets() {
  const clients: JWT[] = [];
  const request = vi.spyOn(JWT.prototype, 'request').mockImplementation((async function(this: JWT, options: { url: string }) {
    clients.push(this); const url = new URL(String(options.url));
    if (url.pathname.endsWith('/values:batchGet')) return { data: { valueRanges: names.map(() => ({ values: [['header']] })) } };
    if (url.searchParams.has('ranges')) return { data: { sheets: names.map(title => ({ properties: { title } })) } };
    return { data: { properties: { locale: 'id_ID' }, sheets: names.map(title => ({ properties: { title, gridProperties: { rowCount: 5, columnCount: 18 } } })) } };
  }) as never);
  return { clients, request };
}

describe('explicit service-account auth without deprecated generic credential options', () => {
  it('loads through the actual GoogleAuth/JWT SDK without keyFilename/credentials warnings and keeps readonly scope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { config } = await configured(); const { clients, request } = fakeSheets();
    const loader = createGoogleSource(config);
    expect(warn).not.toHaveBeenCalled();
    const result = await loader([]);
    expect(result.source).toBe('google-sheets'); expect(result.sheets.map(s => s.name)).toEqual(names);
    expect(request).toHaveBeenCalledTimes(4); expect(new Set(clients).size).toBe(1);
    expect(clients.every(client => client instanceof JWT)).toBe(true);
    expect(clients[0]!.keyFile).toBeUndefined();
    expect(clients[0]!.key === credentials.private_key).toBe(true);
    expect(clients[0]!.email === credentials.client_email).toBe(true);
    expect(clients[0]!.scopes).toEqual([READ_ONLY_SCOPE]);
    expect(clients[0]!.universeDomain).toBe('googleapis.com');
    expect(warn).not.toHaveBeenCalled();
  });

  const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const invalid: Array<[string, unknown]> = [
    ['external_account provider', { ...credentials, type: 'external_account' }],
    ['authorized_user provider', { ...credentials, type: 'authorized_user' }],
    ['missing credential type', { client_email: credentials.client_email, private_key: credentials.private_key }],
    ['invalid email', { ...credentials, client_email: 'not-an-email' }],
    ['invalid private key', { ...credentials, private_key: 'SYNTHETIC_SECRET_SENTINEL' }],
    ['weak RSA key', { ...credentials, private_key: rsa(1024) }],
    ['non-RSA key', { ...credentials, private_key: ecKey }],
    ['malformed JSON', '{SYNTHETIC_SECRET_SENTINEL'],
    ['oversized file', ' '.repeat(70000)],
  ];
  it.each(invalid)('rejects %s before SDK credential autodetection without exposing contents', async (_name, input) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = vi.spyOn(GoogleAuth.prototype, 'getClient').mockRejectedValue(new Error('UNEXPECTED_SDK_AUTH'));
    const { config } = await configured(input); const loader = createGoogleSource(config);
    let failure: unknown; try { await loader([]); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ status: 503, code: 'SOURCE_UNAVAILABLE' });
    expect(failure instanceof Error && failure.message.includes('SYNTHETIC_SECRET_SENTINEL')).toBe(false);
    expect(sdk).not.toHaveBeenCalled();
  });

  it('keeps the explicit ADC path and repeated-range transport without a credential file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = vi.fn(async (options: { url: string }) => {
      const url = new URL(options.url);
      if (url.pathname.endsWith('/values:batchGet')) return { data: { valueRanges: names.map(() => ({ values: [['header']] })) } };
      if (url.searchParams.has('ranges')) return { data: { sheets: names.map(title => ({ properties: { title } })) } };
      return { data: { sheets: names.map(title => ({ properties: { title, gridProperties: { rowCount: 5, columnCount: 18 } } })) } };
    });
    vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({ request } as never);
    const config = readConfig({ GOOGLE_SPREADSHEET_ID: 'SYNTHETIC_ADC_ONLY', GOOGLE_USE_ADC: 'true' });
    await expect(createGoogleSource(config)([])).resolves.toMatchObject({ source: 'google-sheets' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses server-only JSON without reading a file or trusting additional credential fields', async () => {
    const { clients, request } = fakeSheets();
    const config = { ...readConfig({ GOOGLE_SPREADSHEET_ID: 'SYNTHETIC_VERCEL' }), sheetsConfigured: true };
    await expect(createGoogleSource(config, { serviceAccountJson: JSON.stringify(credentials) })([])).resolves.toMatchObject({ source: 'google-sheets' });
    expect(request).toHaveBeenCalledTimes(4);
    expect(clients[0]?.scopes).toEqual([READ_ONLY_SCOPE]);
    expect(clients[0]?.universeDomain).toBe('googleapis.com');
    await expect(createGoogleSource(config, { serviceAccountJson: '{synthetic-private-content' })([])).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', message: expect.not.stringContaining('synthetic-private-content') });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('does not initialize auth when source is unconfigured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sdk = vi.spyOn(GoogleAuth.prototype, 'getClient'); const { config } = await configured('{broken');
    await expect(createGoogleSource({ ...config, sheetsConfigured: false })([])).rejects.toMatchObject({ code: 'SHEETS_UNCONFIGURED' });
    expect(warn).not.toHaveBeenCalled(); expect(sdk).not.toHaveBeenCalled();
  });

  it('retries credential initialization after a failed local read without caching the failure forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { file, config } = await configured(); await rm(file);
    const { request } = fakeSheets(); const loader = createGoogleSource(config);
    await expect(loader([])).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(request).not.toHaveBeenCalled();
    await writeFile(file, JSON.stringify(credentials));
    await expect(loader([])).resolves.toMatchObject({ source: 'google-sheets' });
    expect(warn).not.toHaveBeenCalled();
  });
});
