import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

// Static safety guard for the harness itself. Never load the repository's .env
// merely to demonstrate that an unsafe fixture would have loaded it.
describe('public browser fixture configuration boundary', () => {
  it('explicitly disables Vite environment-file loading before starting the public-entry fixture', async () => {
    const source = await readFile('tests/frontend/public-browser.test.ts', 'utf8');
    expect(source).toMatch(/createServer\(\{[^}]*\benvDir:\s*false\b/);
  });
  it('gives its real browser explicit private scratch temp directories', async () => {
    const source = await readFile('tests/frontend/public-browser.test.ts', 'utf8');
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) expect(source).toMatch(new RegExp(`\\b${key}:\\s*temp\\b`));
    expect(source).toContain('.private/test-tmp/public-browser');
  });
});
