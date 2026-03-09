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
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isDark}
      aria-label={nextLabel}
      className="inline-flex items-center rounded-full border border-border bg-[var(--surface-muted)] p-1 text-text transition hover:bg-[var(--surface-soft)]"
    >
      <span
        className={`relative h-6 w-11 rounded-full border border-border/70 transition ${
          isDark ? 'bg-text/80' : 'bg-white'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full text-[10px] transition-all duration-200 ${
            isDark ? 'left-[22px] bg-bg text-white' : 'left-0.5 bg-text text-white'
          }`}
        >
          {isDark ? (
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 14.5a8.5 8.5 0 1 1-11.3-11.3 7.4 7.4 0 0 0 11.3 11.3Z" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
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
          )}
        </span>
      </span>
      <span className="sr-only">{isDark ? 'Dark mode enabled' : 'Light mode enabled'}</span>
    </button>
  );
}

