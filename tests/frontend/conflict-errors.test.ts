import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, safeApiMessage } from '../../web/lib/api';
describe('FE-03 allowlisted conflict explanations', () => {
  it('explains AMBIGUOUS_ID safely without claiming a snapshot change or exposing server text', async () => {
    const api = new ApiClient(() => 'SYNTHETIC_ONLY', () => {}, async () => new Response(JSON.stringify({ error: { code: 'AMBIGUOUS_ID', message: '<script>UNTRUSTED_PRIVATE_DETAIL</script>' } }), { status: 409 }));
    const error = await api.get('/api/candidates/TEST_01').catch(error => error);
    expect(error).toMatchObject({ status: 409, code: 'AMBIGUOUS_ID' });
    if (!(error instanceof ApiError)) throw new Error('Expected the real ApiClient conflict error');
    expect(error.message).toMatch(/ID.*(berulang|ambigu)/); expect(error.message).toContain('Kualitas data');
    expect(error.message).not.toContain('Snapshot telah berubah'); expect(error.message).not.toContain('UNTRUSTED_PRIVATE_DETAIL');
  });
  it.each(['UNKNOWN_CONFLICT', 'SNAPSHOT_CHANGED_extra', '<script>STALE_SNAPSHOT</script>'])('does not pretend unknown 409 %s is a stale snapshot', code => {
    expect(safeApiMessage(409, code)).not.toContain('Snapshot');
    expect(safeApiMessage(409, code)).not.toContain(code);
  });
  it.each(['SNAPSHOT_CHANGED', 'STALE_SNAPSHOT'])('reserves snapshot guidance for %s', code => {
    expect(safeApiMessage(409, code)).toContain('Snapshot telah berubah');
  });
  it('does not classify unallowlisted lookalike error codes as source configuration failures', () => {
    expect(safeApiMessage(500, 'ATTACKER_UNAVAILABLE_PAYLOAD')).not.toContain('Sumber belum tersedia');
  });
});
