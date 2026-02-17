'use client';

import { useState } from 'react';

import { FirebaseError } from 'firebase/app';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { signInWithEmail } from '@/frameworks/firebase/auth';

const getSignInErrorMessage = (code: string, fallback: string) => {
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is disabled for this project.';
    case 'auth/user-not-found':
      return 'No account found for this email.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return fallback;
  }
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
      router.push('/app');
    } catch (err) {
      const errorCode =
        err instanceof FirebaseError ? err.code : ((err as { code?: string })?.code ?? 'unknown');
      const message =
        err instanceof FirebaseError
          ? err.message
          : err instanceof Error
            ? err.message
            : ((err as { message?: string })?.message ?? 'Unable to sign in.');
      console.warn('Sign-in error:', {
        code: errorCode,
        message,
        raw: err,
      });
      setError(getSignInErrorMessage(errorCode, message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-6 py-12 text-text">
      <div className="absolute left-0 top-0 h-64 w-64 -translate-x-1/3 -translate-y-1/3 rounded-full bg-accent/40 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-80 w-80 translate-x-1/3 translate-y-1/3 rounded-full bg-surface-strong/70 blur-3xl" />

      <div className="relative z-10 w-full max-w-md rounded-[32px] border border-border/60 bg-surface/90 p-8 shadow-floating">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Welcome back
            </p>
            <Image
              src="/dmd-logo.svg"
              alt="DMD Lights"
              width={160}
              height={80}
              priority
              className="h-20 w-auto"
            />
          </div>
          <ThemeToggle />
        </div>

        <p className="mt-3 text-sm text-muted">Sign in with your admin-approved credentials.</p>

        <form className="mt-6 space-y-4" onSubmit={onSignIn}>
          <label className="block text-xs font-semibold uppercase tracking-[0.22em] text-muted">
            Email
            <input
              type="email"
              placeholder="name@company.com"
              id="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none transition focus:border-accent/80"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-[0.22em] text-muted">
            Password
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 focus-within:border-accent/80">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your secure password"
                id="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="grid h-8 w-8 place-items-center rounded-full border border-border/60 text-muted transition hover:bg-hover/70"
              >
                {showPassword ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5" />
                    <path d="M9.8 5.8A10.5 10.5 0 0 1 12 5c4.8 0 8.9 3.1 10 7-0.4 1.3-1.1 2.6-2.2 3.7" />
                    <path d="M6.3 6.3C4.5 7.5 3.1 9.1 2 12c0.9 3 3.8 6.5 10 6.5 1.7 0 3.2-0.3 4.5-0.9" />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 12c1.7-4.5 5.7-7 10-7s8.3 2.5 10 7c-1.7 4.5-5.7 7-10 7s-8.3-2.5-10-7Z" />
                    <circle cx="12" cy="12" r="3.5" />
                  </svg>
                )}
              </button>
            </div>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-sm font-semibold text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-2xl border border-border/60 bg-bg/70 p-3 text-xs text-muted">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
