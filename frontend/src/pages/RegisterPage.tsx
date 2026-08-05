// src/pages/RegisterPage.tsx
import { useState, FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

export default function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register(email, username, password);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#f4f6fa]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e2a5e] text-lg font-bold text-white">
            IG
          </div>
          <h1 className="text-xl font-bold text-slate-900">Infra Genie</h1>
          <p className="text-sm text-slate-500">AI-Powered CloudOps</p>
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
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1e2a5e] focus:ring-1 focus:ring-[#1e2a5e]"
                placeholder="you@company.com"
              />
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
              disabled={isSubmitting}
              className="w-full rounded-lg bg-[#1e2a5e] py-2.5 text-sm font-semibold text-white transition hover:bg-[#16204a] disabled:opacity-60"
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
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
    </div>
  );
}