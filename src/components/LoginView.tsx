import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, Store, User } from 'lucide-react';
import { ENDPOINT_CONFIG } from '../config/endpoint';
import { ApiError, loginPreviewSupervisor, loginWithAccount } from '../services/api';
import type { SessionInfo } from '../types/store';

interface LoginViewProps {
  onLoginSuccess: (session: SessionInfo) => void;
  sessionNotice?: string | null;
}

export function LoginView({ onLoginSuccess, sessionNotice }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMessage('Username dan password wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await loginWithAccount(trimmedUser, password);
      if (!result.token || !result.supervisor || !result.username || !result.role) {
        setErrorMessage('Respons autentikasi dari server tidak lengkap.');
        return;
      }
      onLoginSuccess({
        token: result.token,
        supervisor: result.supervisor,
        username: result.username,
        role: result.role,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Gagal melakukan login. Silakan coba lagi.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePreviewSignIn(supervisorName: string) {
    setErrorMessage(null);
    setPreviewLoadingKey(supervisorName);
    try {
      const result = await loginPreviewSupervisor(supervisorName);
      if (!result.token || !result.supervisor || !result.username || !result.role) {
        setErrorMessage('Gagal memulai sesi pratinjau.');
        return;
      }
      onLoginSuccess({
        token: result.token,
        supervisor: result.supervisor,
        username: result.username,
        role: result.role,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Gagal masuk ke mode pratinjau lokal.');
      }
    } finally {
      setPreviewLoadingKey(null);
    }
  }

  const busy = isSubmitting || previewLoadingKey !== null;

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Kolom Pengantar */}
        <section className="lg:col-span-6 space-y-4">
        </section>

        {/* Kolom Formulir Login SFA */}
        <main className="lg:col-span-6 w-full">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-lg">
            <div className="mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">Menu Login</h2>
            </div>

            {sessionNotice && (
              <div
                role="status"
                className="mb-5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900"
              >
                {sessionNotice}
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="mb-5 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"
              >
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <User
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={busy}
                    placeholder="Masukkan username"
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-slate-300 bg-slate-50/50 text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Masukkan password"
                    className="w-full h-12 pl-10 pr-12 rounded-xl border border-slate-300 bg-slate-50/50 text-slate-900 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    disabled={busy}
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[50px] mt-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 shadow-md whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    <span>Memverifikasi...</span>
                  </>
                ) : (
                  <span>Login</span>
                )}
              </button>
            </form>

            {ENDPOINT_CONFIG.isLocalPreview && (
              <div className="mt-6 pt-5 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
                  Akun Demo
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePreviewSignIn('Budi Santoso')}
                    className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 shadow-2xs"
                  >
                    <span className="block text-sm font-bold text-slate-900">
                      {previewLoadingKey === 'Budi Santoso' ? 'Memuat...' : 'Budi Santoso'}
                    </span>
                    <span className="block text-xs text-slate-600">Supervisor · Jakarta</span>
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePreviewSignIn('Siti Rahayu')}
                    className="min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 shadow-2xs"
                  >
                    <span className="block text-sm font-bold text-slate-900">
                      {previewLoadingKey === 'Siti Rahayu' ? 'Memuat...' : 'Siti Rahayu'}
                    </span>
                    <span className="block text-xs text-slate-600">Supervisor · Bandung</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
