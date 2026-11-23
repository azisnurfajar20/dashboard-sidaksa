import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuth } from 'google-auth-library';
import { createGoogleSource } from '../../server/google';
import { readConfig } from '../../server/config';

const names = ['Data Kandidat', 'Data Mitra Agent', 'Data Company', 'Proses Rekrutment'];
const ranges = ["'Data Kandidat'!A1:I5", "'Data Mitra Agent'!A1:F5", "'Data Company'!A1:H5", "'Proses Rekrutment'!A1:R5"];
afterEach(() => vi.restoreAllMocks());

describe('Google production request serialization (SDK boundary, no credentials/network)', () => {
  it('sends each approved range as a repeated query parameter rather than one comma-joined value', async () => {
    const calls: { url: string; params?: Record<string, unknown>; method: string; timeout: number }[] = [];
    const transport = vi.fn(async (options: typeof calls[number]) => {
      calls.push(options);
      const url = new URL(String(options.url));
      if (url.pathname.endsWith('/values:batchGet')) return { data: { valueRanges: names.map(() => ({ values: [['header']] })) } };
      if (url.searchParams.has('ranges') || options.params?.ranges) return { data: { sheets: names.map(title => ({ properties: { title } })) } };
      return { data: { properties: { locale: 'id_ID' }, sheets: names.map(title => ({ properties: { title, gridProperties: { rowCount: 5, columnCount: 18 } } })) } };
    });
    vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({ request: transport } as never);
    const config = readConfig({ GOOGLE_SPREADSHEET_ID: 'SYNTHETIC_TRANSPORT_ONLY', GOOGLE_USE_ADC: 'true' });
    await createGoogleSource(config)([]);
    const values = calls.filter(call => new URL(String(call.url)).pathname.endsWith('/values:batchGet'));
    expect(values).toHaveLength(2);
    for (const call of values) {
      const url = new URL(String(call.url));
      expect(url.searchParams.getAll('ranges')).toEqual(ranges);
      expect(url.searchParams.get('majorDimension')).toBe('ROWS');
      expect(call.method).toBe('GET');
      expect(call.timeout).toBe(12000);
    }
    const formats = calls.find(call => new URL(String(call.url)).searchParams.has('ranges') && !new URL(String(call.url)).pathname.endsWith('/values:batchGet'));
    expect(formats).toBeDefined();
    expect(new URL(String(formats!.url)).searchParams.getAll('ranges')).toEqual(ranges);
    expect(new URL(String(formats!.url)).searchParams.get('fields')).toContain('effectiveFormat(numberFormat(type,pattern))');
  });
});
