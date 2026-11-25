import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, createSupabaseAuthenticator, permissions } from './auth.js';
import { publicConfig, readAuthConfig } from './config.js';

function readRuntimeAuthConfig() {
  try { return readAuthConfig(); }
  catch { throw new ApiError(503, 'AUTH_UNCONFIGURED', 'Konfigurasi Supabase Auth tidak valid.'); }
}

export function hostedAuthHandler(endpoint: 'public-config' | 'me') {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const reply = (status: number, body: object) => {
      res.statusCode = status;
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Metode permintaan tidak diizinkan.');
      }
      if (endpoint === 'public-config') {
        reply(200, publicConfig(readRuntimeAuthConfig()));
        return;
      }
      const header = req.headers.authorization;
      if (!header || header.length > 8192 || !/^Bearer [^\s,]+$/i.test(header)) {
        throw new ApiError(401, 'AUTH_REQUIRED', 'Sesi login diperlukan.');
      }
      const config = readRuntimeAuthConfig();
      const authenticate = createSupabaseAuthenticator({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey });
      const user = await authenticate(header.slice(7));
      reply(200, { user, permissions: permissions(user.role) });
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError(503, 'AUTH_UNAVAILABLE', 'Layanan autentikasi tidak tersedia.');
      reply(failure.status, { error: { code: failure.code, message: failure.message } });
    }
  };
}