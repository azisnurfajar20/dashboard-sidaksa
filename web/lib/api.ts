import type { ApiFailure } from '../../shared/contracts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ApiError'; }
}

export function safeApiMessage(status: number, code = ''): string {
  if (status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (status === 403) return 'Akun Anda belum disetujui atau tidak memiliki izin untuk tindakan ini.';
  if (status === 409) {
    if (code === 'AMBIGUOUS_ID') return 'ID sumber berulang atau ambigu. Tinjau masalah identitas pada Kualitas data; memuat ulang tidak menyelesaikan ID berulang.';
    if (code === 'SNAPSHOT_CHANGED' || code === 'STALE_SNAPSHOT') return 'Snapshot telah berubah. Muat ulang data sebelum mencoba lagi.';
    return 'Permintaan bertentangan dengan kondisi data saat ini. Periksa data atau hubungi admin.';
  }
  if (status === 429) return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
  if (code === 'HOSTED_DATA_UNCONFIGURED' || code === 'STORE_UNAVAILABLE') return 'Penyimpanan privat SIDAKSA belum siap. Admin perlu memeriksa konfigurasi penyimpanan di Vercel.';
  if (code === 'SHEETS_UNCONFIGURED') return 'Koneksi Google Sheets belum dikonfigurasi di server.';
  if (code === 'SNAPSHOT_UNAVAILABLE') return 'Snapshot Google Sheets belum tersedia. Admin dapat memilih “Sinkronkan sekarang” di Pengaturan.';
  if (status === 503 || ['AUTH_UNCONFIGURED', 'AUTH_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'REFERENCE_UNAVAILABLE', 'NO_SNAPSHOT'].includes(code)) return 'Sumber belum tersedia. Periksa kesiapan integrasi dan snapshot terakhir.';
  if (status === 400) return 'Permintaan belum valid. Periksa isian dan filter Anda.';
  return 'Data tidak dapat dimuat. Coba lagi atau hubungi admin.';
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export class ApiClient {
  constructor(private token: () => string | null, private unauthorized: (requestToken: string | null) => void, private fetcher: Fetcher = (url, init) => fetch(url, init)) {}
  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (!/^\/api\/(?!\/)/.test(path) || /[\r\n\\]/.test(path)) throw new ApiError(0, 'INVALID_PATH', 'Alamat API tidak valid.');
    const headers = new Headers(options.headers);
    const token = this.token();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    let response: Response;
    try { response = await this.fetcher(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }); }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new ApiError(0, 'NETWORK', 'Koneksi terputus. Periksa jaringan lalu coba lagi.'); }
    if (!response.ok) {
      let failure: ApiFailure | null = null;
      try { failure = await response.json() as ApiFailure; } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        // Never surface HTML or untrusted error bodies.
      }
      // Cancellation can race headers/body parsing, even when the body ignores abort.
      options.signal?.throwIfAborted();
      if (response.status === 401) this.unauthorized(token);
      const code = typeof failure?.error?.code === 'string' ? failure.error.code : 'REQUEST_FAILED';
      throw new ApiError(response.status, code, safeApiMessage(response.status, code));
    }
    return response;
  }
  async get<T>(path: string, signal?: AbortSignal): Promise<T> { return (await this.request(path, { signal })).json() as Promise<T>; }
  async send<T>(path: string, method: 'POST' | 'PUT', body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.request(path, { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  async csv(path: string, signal?: AbortSignal): Promise<Blob> { return (await this.request(path, { signal })).blob(); }
}
