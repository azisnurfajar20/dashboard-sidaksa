import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginView } from '../../web/auth/Login';
import type { PublicConfig } from '../../shared/contracts';
const config: PublicConfig = { appName: 'SIDAKSA', authConfigured: false, supabaseUrl: null, supabasePublishableKey: null, googleOAuthEnabled: false };
describe('honest login surface', () => {
  it('renders the actual disabled credential form and setup warning without demo access', () => {
    const html = renderToStaticMarkup(<LoginView config={config} busy={false} onPassword={async () => {}} onGoogle={async () => {}} />);
    expect(html).toContain('SIDAKSA'); expect(html).toContain('Konfigurasi login belum tersedia');
    expect(html).toContain('data-testid="login-submit"'); expect(html).toMatch(/type="password"[^>]*disabled/);
    expect(html).toContain('.env'); expect(html).not.toContain('Daftar akun'); expect(html).not.toContain('data-testid="login-google"');
  });
  it('enables configured password login but exposes OAuth only when explicitly enabled', () => {
    const html = renderToStaticMarkup(<LoginView config={{ ...config, authConfigured: true, supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'publishable', googleOAuthEnabled: true }} busy={false} onPassword={async () => {}} onGoogle={async () => {}} />);
    expect(html).toContain('data-testid="login-google"'); expect(html).toMatch(/autoComplete="current-password"/i);
    expect(html).not.toContain('Konfigurasi login belum tersedia'); expect(html).not.toContain('disabled=""');
  });
});
