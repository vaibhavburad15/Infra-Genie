// src/pages/RegisterPage.tsx
import { useState, FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/api';
import * as api from '@/api';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

const ADMIN_CONTACT_MESSAGE = 'Admin accounts cannot be created here. Contact Vaibhav or Raj for admin access.';

export default function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [otp, setOtp] = useState('');
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdminNotice, setShowAdminNotice] = useState(false);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGetOtp() {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }

    setError(null);
    setOtpMessage(null);
    setIsSendingOtp(true);
    try {
      const response = await api.requestEmailOtp({ email });
      setIsOtpSent(true);
      setIsEmailVerified(false);
      setOtp('');
      setOtpMessage(
        response.dev_otp
          ? `${response.message} Dev OTP: ${response.dev_otp}`
          : `${response.message}. Check your inbox.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP.');
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function handleVerifyOtp() {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    if (!otp.trim()) {
      setError('Enter the OTP sent to your email.');
      return;
    }

    setError(null);
    setOtpMessage(null);
    setIsVerifyingOtp(true);
    try {
      const response = await api.verifyEmailOtp({ email, otp });
      setIsEmailVerified(true);
      setOtpMessage(response.message);
    } catch (err) {
      setIsEmailVerified(false);
      setError(err instanceof Error ? err.message : 'Could not verify OTP.');
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (role === 'admin') {
      setShowAdminNotice(true);
      return;
    }

    if (!isEmailVerified) {
      setError('Verify your email OTP before creating an account.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register(email, username, password, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#f4f6fa]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            <img src="/favicon.png" alt="Infra Genie logo" className="h-10 w-10 object-contain" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Infra Genie</h1>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Create an account</h2>
          <p className="mb-6 text-sm text-slate-500">Get started with Infra Genie.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
                placeholder="vaibhav"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setIsEmailVerified(false);
                    setOtpMessage(null);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
                  placeholder="you@company.com"
                />
                <button
                  type="button"
                  onClick={handleGetOtp}
                  disabled={isSendingOtp}
                  className="shrink-0 rounded-lg border border-[#1e2a5e] px-3 py-2 text-sm font-semibold text-[#1e2a5e] transition hover:bg-[#edf1fb] disabled:opacity-60"
                >
                  {isSendingOtp ? 'Sending…' : 'Get OTP'}
                </button>
              </div>
            </div>

            {isOtpSent && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email OTP</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setIsEmailVerified(false);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
                    placeholder="Enter 6-digit code"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isVerifyingOtp}
                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isVerifyingOtp ? 'Verifying…' : isEmailVerified ? 'Verified' : 'Verify'}
                  </button>
                </div>
              </div>
            )}

            {otpMessage && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{otpMessage}</p>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
              <select
                required
                value={role}
                onChange={(e) => {
                  const selectedRole = e.target.value as UserRole;
                  setRole(selectedRole);
                  if (selectedRole === 'admin') {
                    setShowAdminNotice(true);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
              >
                <option value="user">User</option>
                <option value="developer">Developer</option>
                <option value="devops_engineer">DevOps Engineer</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || role === 'admin' || !isEmailVerified}
              className="w-full rounded-lg bg-[#1e2a5e] py-2.5 text-sm font-semibold text-white transition hover:bg-[#16204a] disabled:opacity-60"
            >
              {isSubmitting
                ? 'Creating account...'
                : role === 'admin'
                  ? 'Admin sign-up unavailable'
                  : !isEmailVerified
                    ? 'Verify email OTP first'
                    : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <button onClick={onSwitchToLogin} className="font-medium text-[#1e2a5e] hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>

      {showAdminNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-role-title"
        >
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="admin-role-title" className="text-base font-semibold text-slate-900">
              Admin access restricted
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{ADMIN_CONTACT_MESSAGE}</p>
            <button
              type="button"
              onClick={() => {
                setRole('user');
                setShowAdminNotice(false);
              }}
              className="mt-5 w-full rounded-lg bg-[#1e2a5e] py-2.5 text-sm font-semibold text-white transition hover:bg-[#16204a]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
