'use client';

import { useSyncExternalStore } from 'react';

import { useTheme } from '@/components/theme/ThemeProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!mounted) {
    return null;
  }
  const nextLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={nextLabel}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--surface-muted)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-text transition hover:bg-[var(--surface-soft)]"
    >
      <span className="grid h-5 w-5 place-items-center text-text">
        {theme === 'dark' ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3.5v2.2" />
            <path d="M12 18.3v2.2" />
            <path d="M4.7 4.7l1.6 1.6" />
            <path d="M17.7 17.7l1.6 1.6" />
            <path d="M3.5 12h2.2" />
            <path d="M18.3 12h2.2" />
            <path d="M4.7 19.3l1.6-1.6" />
            <path d="M17.7 6.3l1.6-1.6" />
            <circle cx="12" cy="12" r="3.6" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 14.5a8.5 8.5 0 1 1-11.3-11.3 7.4 7.4 0 0 0 11.3 11.3Z" />
          </svg>
        )}
      </span>
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

