import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/ui';

export function PasswordChangePage() {
  const { config, session } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!config) return <p className="text-secondary">Konfigurasi akses belum dimuat.</p>;
  if (session.phase !== 'authorized' || !session.me) return <p className="text-secondary">Anda harus login untuk mengakses halaman ini.</p>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Kata sandi baru dan konfirmasi tidak cocok.' });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Kata sandi baru minimal 6 karakter.' });
      return;
    }
    setLoading(true);
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(config.supabaseUrl!, config.supabasePublishableKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      });

      // Update password (the user is already authorized)
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });
      if (updateError) {
        throw updateError;
      }

      setMessage({ type: 'success', text: 'Kata sandi berhasil diperbarui. Silakan login ulang.' });
      // Redirect after a short delay
      setTimeout(() => {
        window.location.href = `${window.location.origin}/`;
      }, 1500);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Gagal mengubah kata sandi.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="Ubah Kata Sandi" description="Ganti kata sandi akun Anda." />
      {message && <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`} role="alert">{message.text}</div>}
      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="settings-section">
          <div className="panel-heading">
            <h2>Verifikasi dan Ubah Kata Sandi</h2>
          </div>
          <div className="mb-3">
            <label htmlFor="current-password" className="form-label">Kata Sandi Saat Ini</label>
            <input
              id="current-password"
              type="password"
              className="form-control"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="mb-3">
            <label htmlFor="new-password" className="form-label">Kata Sandi Baru</label>
            <input
              id="new-password"
              type="password"
              className="form-control"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div className="mb-3">
            <label htmlFor="confirm-password" className="form-label">Konfirmasi Kata Sandi Baru</label>
            <input
              id="confirm-password"
              type="password"
              className="form-control"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Memproses...' : 'Ubah Kata Sandi'}
          </button>
        </div>
      </form>
    </div>
  );
}
