
import type { ApiFailure } from '../../shared/contracts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function safeApiMessage(
  status: number,
  code = ''
): string {
  // Autentikasi pengguna.
  if (status === 401) {
    return 'Sesi berakhir. Silakan masuk kembali.';
  }

  if (status === 403) {
    return 'Akun Anda belum disetujui atau tidak memiliki izin untuk tindakan ini.';
  }

  // Konflik perubahan data.
  if (status === 409) {
    if (code === 'AMBIGUOUS_ID') {
      return 'ID sumber berulang atau ambigu. Tinjau masalah identitas pada Kualitas Data.';
    }

    if (
      code === 'SNAPSHOT_CHANGED' ||
      code === 'STALE_SNAPSHOT'
    ) {
      return 'Snapshot telah berubah. Muat ulang data sebelum mencoba lagi.';
    }

    if (code === 'STORE_CONFLICT') {
      return 'Data sedang mengalami perubahan. Muat ulang halaman sebelum mencoba lagi.';
    }

    if (code === 'SYNC_RUNNING') {
      return 'Sinkronisasi Google Sheets sedang berjalan. Tunggu hingga proses selesai.';
    }

    return 'Permintaan bertentangan dengan kondisi data saat ini. Periksa data atau hubungi admin.';
  }

  // Pembatasan permintaan.
  if (status === 429) {
    return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
  }

  // Konfigurasi backend Vercel.
  if (code === 'HOSTED_DATA_UNCONFIGURED') {
    return 'Konfigurasi backend SIDAKSA belum lengkap. Admin perlu memeriksa Environment Variables di Vercel.';
  }

  // Penyimpanan internal Google Sheets.
  if (code === 'STORE_UNAVAILABLE') {
    return 'Penyimpanan internal Google Sheets belum tersedia. Periksa koneksi Google Apps Script dan konfigurasi server.';
  }

  if (code === 'STORE_INVALID') {
    return 'Data penyimpanan internal SIDAKSA tidak valid. Hubungi admin untuk melakukan pemulihan.';
  }

  // Koneksi sumber Google Sheets.
  if (code === 'SHEETS_UNCONFIGURED') {
    return 'Koneksi Google Sheets belum dikonfigurasi. Admin perlu memeriksa Spreadsheet ID dan kredensial Google.';
  }

  if (code === 'SOURCE_UNAVAILABLE') {
    return 'Sumber data Google Sheets tidak dapat diakses. Periksa koneksi dan izin akses spreadsheet.';
  }

  if (code === 'REFERENCE_UNAVAILABLE') {
    return 'Data referensi Google Sheets belum tersedia. Periksa konfigurasi tab referensi.';
  }

  // Snapshot Google Sheets.
  if (
    code === 'SNAPSHOT_UNAVAILABLE' ||
    code === 'NO_SNAPSHOT'
  ) {
    return 'Snapshot Google Sheets belum tersedia. Admin dapat memilih “Sinkronkan sekarang” di Pengaturan.';
  }

  // Autentikasi server.
  if (code === 'AUTH_UNCONFIGURED') {
    return 'Konfigurasi autentikasi SIDAKSA belum tersedia. Hubungi admin.';
  }

  if (code === 'AUTH_UNAVAILABLE') {
    return 'Layanan autentikasi sedang tidak tersedia. Silakan coba kembali.';
  }

  // Gangguan server.
  if (status === 503) {
    return 'Layanan SIDAKSA sementara belum tersedia. Periksa koneksi dan konfigurasi server.';
  }

  if (status === 400) {
    return 'Permintaan belum valid. Periksa isian dan filter Anda.';
  }

  return 'Data tidak dapat dimuat. Coba lagi atau hubungi admin.';
}

type Fetcher = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class ApiClient {
  constructor(
    private token: () => string | null,

    private unauthorized: (
      requestToken: string | null
    ) => void,

    private fetcher: Fetcher = (url, init) =>
      fetch(url, init)
  ) {}

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    // Hanya mengizinkan endpoint API internal.
    if (
      !/^\/api\/(?!\/)/.test(path) ||
      /[\r\n\\]/.test(path)
    ) {
      throw new ApiError(
        0,
        'INVALID_PATH',
        'Alamat API tidak valid.'
      );
    }

    const headers = new Headers(
      options.headers
    );

    const token = this.token();

    if (token) {
      headers.set(
        'Authorization',
        `Bearer ${token}`
      );
    }

    headers.set(
      'Accept',
      'application/json'
    );

    let response: Response;

    try {
      response = await this.fetcher(path, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        throw error;
      }

      options.signal?.throwIfAborted();

      throw new ApiError(
        0,
        'NETWORK',
        'Koneksi terputus. Periksa jaringan lalu coba lagi.'
      );
    }

    if (!response.ok) {
      let failure: ApiFailure | null = null;

      try {
        failure =
          (await response.json()) as ApiFailure;
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === 'AbortError'
        ) {
          throw error;
        }

        // Jangan tampilkan HTML atau pesan
        // mentah dari server kepada pengguna.
      }

      options.signal?.throwIfAborted();

      if (response.status === 401) {
        this.unauthorized(token);
      }

      const code =
        typeof failure?.error?.code === 'string'
          ? failure.error.code
          : 'REQUEST_FAILED';

      throw new ApiError(
        response.status,
        code,
        safeApiMessage(
          response.status,
          code
        )
      );
    }

    return response;
  }

  async get<T>(
    path: string,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await this.request(
      path,
      { signal }
    );

    return response.json() as Promise<T>;
  }

  async send<T>(
    path: string,
    method: 'POST' | 'PUT',
    body: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await this.request(
      path,
      {
        method,
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }

  async csv(
    path: string,
    signal?: AbortSignal
  ): Promise<Blob> {
    const response = await this.request(
      path,
      { signal }
    );

    return response.blob();
  }
}
