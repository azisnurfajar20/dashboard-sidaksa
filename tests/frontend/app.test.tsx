import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../web/auth/AuthProvider', async importOriginal => ({ ...await importOriginal<object>(), useAuth: () => ({ session: { me: { user: { id: 'u', email: 'leader@example.invalid', role: 'leader' }, permissions: { manageData: false, viewContact: false, exportDetail: false } } }, logout: async () => {} }) }));
vi.mock('../../web/lib/useResource', () => ({ useResource: () => ({ state: 'ready', data: null, error: null, reload: () => {} }) }));
describe('application routing', () => {
  it('renders a usable overview route and rejects settings for a non-admin', async () => {
    const module = await import('../../web/App');
    const overview = renderToStaticMarkup(<MemoryRouter><module.AppRoutes/></MemoryRouter>);
    expect(overview).toContain('id="page-title">Overview');
    expect(overview).toContain('Belum ada snapshot');
    const settings = renderToStaticMarkup(<MemoryRouter initialEntries={['/pengaturan']}><module.AppRoutes/></MemoryRouter>);
    expect(settings).toContain('Akses admin diperlukan');
    expect(settings).not.toContain('data-testid="settings-save"');
  });
});
