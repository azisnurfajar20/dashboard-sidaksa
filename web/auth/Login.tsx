import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { PublicConfig } from '../../shared/contracts';
import { hasAuthConfiguration } from './session';
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><div><span className="brand-name">SIDAKSA</span><span className="brand-caption">Akses kerja & alumni</span></div></div>;
}
export interface LoginProps { config: PublicConfig | null; busy: boolean; error?: string | null; onPassword: (email: string, password: string) => Promise<void>; onGoogle: () => Promise<void> }
export function LoginView({ config, busy, error, onPassword, onGoogle }: LoginProps) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [visible, setVisible] = useState(false);
  const ready = hasAuthConfiguration(config); const disabled = !ready || busy;
  async function submit(event: FormEvent) { event.preventDefault(); if (disabled) return; const value = password; setPassword(''); await onPassword(email.trim(), value); }
  return <main className="login-layout">
    <section className="login-identity" aria-label="Identitas aplikasi"><Brand/><div className="identity-body"><p className="eyebrow">MONITORING INTERNAL</p><h1>Satu pandangan.<br/>Data yang dapat<br/>ditelusuri.</h1><p>Pantau kandidat, proses rekrutmen, dan catatan penempatan dari sumber organisasi.</p><div className="identity-rule"/><p className="identity-note"><ShieldCheck size={20} aria-hidden="true"/> Akses terbatas untuk akun yang disetujui.</p></div><div className="identity-footer">Google Sheets privat <span aria-hidden="true">·</span> Akses baca-saja</div></section>
    <section className="login-form-panel"><div className="login-mobile-brand"><Brand/></div><div className="login-form-wrap"><span className="section-kicker"><LockKeyhole size={16} aria-hidden="true"/> AREA TERBATAS</span><h2>Masuk ke dashboard</h2><p className="text-secondary mb-4">Gunakan akun internal yang telah disetujui admin.</p>
      {!ready && <div className="setup-alert" role="status" data-testid="auth-setup"><TriangleAlert size={20} aria-hidden="true"/><div><strong>Konfigurasi login belum tersedia</strong><p>Admin perlu menyiapkan Supabase Auth pada <code>.env</code> server. Login belum dapat digunakan; tidak ada akses demo.</p></div></div>}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <form onSubmit={submit} aria-label="Masuk dengan email" data-testid="login-form"><div className="mb-3"><label className="form-label" htmlFor="login-email">Email internal</label><input className="form-control" id="login-email" name="email" type="email" autoComplete="username" required disabled={disabled} value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@organisasi.id" data-testid="login-email"/></div>
      <div className="mb-4"><label className="form-label" htmlFor="login-password">Kata sandi</label><div className="password-field"><input className="form-control" id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required disabled={disabled} value={password} onChange={e => setPassword(e.target.value)} data-testid="login-password"/><button type="button" className="password-toggle" aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
      <button className="btn btn-primary w-100 login-submit" disabled={disabled} type="submit" data-testid="login-submit">{busy ? 'Memverifikasi akses…' : 'Masuk'}<ArrowRight size={18} aria-hidden="true"/></button></form>
      {ready && config?.googleOAuthEnabled && <><div className="login-divider"><span>atau</span></div><button className="btn btn-outline-primary w-100" type="button" disabled={busy} onClick={() => void onGoogle()} data-testid="login-google">Masuk dengan Google</button></>}
      <p className="login-help">Belum mempunyai akses? Hubungi admin organisasi.<br/>Pendaftaran publik tidak tersedia.</p><div className="login-privacy"><ShieldCheck size={17} aria-hidden="true"/><span>Identitas dikelola Supabase Auth. Kredensial sumber Google Sheets tetap berada di server.</span></div>
    </div><p className="login-bottom">SIDAKSA <span aria-hidden="true">/</span> Ruang kerja akses kerja & alumni</p></section></main>;
}
