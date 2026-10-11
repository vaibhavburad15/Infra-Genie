// src/pages/LoginPage.tsx
import { useState, FormEvent } from 'react';
import { useAuth } from '@/context/useAuth';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

export default function LoginPage({ onSwitchToRegister }: LoginPageProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-canvas">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            <img src="/favicon.png" alt="Infra Genie logo" className="h-10 w-10 object-contain" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Infra Genie</h1>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Sign in</h2>
          <p className="mb-6 text-sm text-gray-500">Welcome back — enter your details.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-60"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <button onClick={onSwitchToRegister} className="font-medium text-primary hover:underline">
              Create one
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
