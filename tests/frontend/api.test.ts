import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../web/lib/api';

describe('same-origin authenticated API transport', () => {
  it('sends the session only as a bearer header and preserves exact query tokens', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { headers: { 'Content-Type': 'application/json' } }));
    const api = new ApiClient(() => 'test-session-token', () => {}, fetcher);
    await expect(api.get('/api/applications?candidate=DKDP_014')).resolves.toEqual({ rows: [] });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/applications?candidate=DKDP_014');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-session-token');
    expect(init.cache).toBe('no-store');
    expect(url).not.toContain('test-session-token');
  });
  it('clears authorization on a 401 and never exposes an unsafe server error', async () => {
    const expired = vi.fn();
    const api = new ApiClient(() => 'expired', expired, async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'private server payload' } }), { status: 401 }));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401, message: 'Sesi berakhir. Silakan masuk kembali.' });
    expect(expired).toHaveBeenCalledOnce();
  });
  it('rejects remote URLs before leaking a token', async () => {
    const fetcher = vi.fn();
    const api = new ApiClient(() => 'private-token', () => {}, fetcher);
    await expect(api.get('https://outside.invalid/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves AbortError from a 401 response body without an unauthorized side effect', async () => {
    const expired = vi.fn(); const bodyAbort = new DOMException('Synthetic body cancellation', 'AbortError');
    const api = new ApiClient(() => 'obsolete', expired, async () => new Response(new ReadableStream({ start(controller) { controller.error(bodyAbort); } }), { status: 401 }));
    await expect(api.get('/api/me')).rejects.toBe(bodyAbort);
    expect(expired).not.toHaveBeenCalled();
  });
  it.each(['resolved', 'malformed'])('rechecks cancellation when an obsolete 401 body %s after abort', async outcome => {
    const expired = vi.fn(); const abort = new AbortController();
    let release!: () => void; let started!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    const response = new Response('{}', { status: 401 });
    response.json = async () => { started(); await body; if (outcome === 'malformed') throw new SyntaxError('Untrusted malformed body'); return { error: { code: 'UNAUTHORIZED' } }; };
    const api = new ApiClient(() => 'obsolete', expired, async () => response);
    const pending = api.get('/api/me', abort.signal); await reading; abort.abort(); release();
    await expect(pending).rejects.toBe(abort.signal.reason);
    expect(expired).not.toHaveBeenCalled();
  });
  it('still clears current authorization when a 401 body is malformed and never exposes it', async () => {
    const expired = vi.fn();
    const api = new ApiClient(() => 'current', expired, async () => new Response('<html>UNTRUSTED_PRIVATE_BODY</html>', { status: 401 }));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401, code: 'REQUEST_FAILED', message: 'Sesi berakhir. Silakan masuk kembali.' });
    expect(expired).toHaveBeenCalledOnce();
  });
  it('attributes a late 401 to the token captured when the request was sent', async () => {
    const original = 'SYNTHETIC_REQUEST_OWNER_A'; let current = original; let attributedToOriginal = false;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const api = new ApiClient(() => current, (failedToken?: string | null) => { attributedToOriginal = failedToken === original; }, async () => { await gate; return new Response('{}', { status: 401 }); });
    const pending = api.get('/api/applications'); current = 'SYNTHETIC_REQUEST_OWNER_C'; release();
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(attributedToOriginal, 'unauthorized attribution must use the captured request token, not the current supplier').toBe(true);
  });
  it('passes cancellation through without turning it into an empty result', async () => {
    const abort = new AbortController(); abort.abort();
    const api = new ApiClient(() => 'token', () => {}, async (_url, options) => { options?.signal?.throwIfAborted(); return new Response('{}'); });
    await expect(api.get('/api/candidates', abort.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});
