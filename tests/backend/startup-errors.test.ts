import { describe, expect, it } from 'vitest';
import { startupErrorMessage } from '../../server/index';

describe('safe actionable startup errors', () => {
  it('identifies a rejected private cache without blaming Excel or exposing internal values', () => {
    const error = Object.assign(new Error('FICTITIOUS_PRIVATE_VALUE_DO_NOT_DISPLAY'), { code: 'STORE_INVALID' });
    const message = startupErrorMessage(error);
    expect(message).toMatch(/cache|snapshot/i);
    expect(message).toMatch(/kompatibilitas|integritas/i);
    expect(message).toMatch(/jangan hapus/i);
    expect(message).not.toContain('FICTITIOUS_PRIVATE_VALUE_DO_NOT_DISPLAY');
  });
  it('does not expose unknown internal errors', () => {
    expect(startupErrorMessage(new Error('FICTITIOUS_SECRET_123'))).not.toContain('FICTITIOUS_SECRET_123');
  });
});
