import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider, ProtectedApp } from '../../web/auth/AuthProvider';
describe('protected component tree', () => {
  it('does not mount or render protected children before configuration and permission checks', () => {
    let privateRenderCount = 0;
    function Private() { privateRenderCount++; return <div>private-row-token</div>; }
    const html = renderToStaticMarkup(<AuthProvider><ProtectedApp><Private/></ProtectedApp></AuthProvider>);
    expect(html).toContain('Memeriksa konfigurasi akses');
    expect(html).not.toContain('private-row-token'); expect(privateRenderCount).toBe(0);
  });
});
