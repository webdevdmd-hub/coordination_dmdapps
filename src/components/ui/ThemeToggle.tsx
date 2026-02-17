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
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:-translate-y-[1px] hover:bg-hover/80"
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/70 text-text">
        {theme === 'dark' ? (
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
            className="h-4 w-4"
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
