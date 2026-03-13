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
      className="group relative inline-flex h-10 w-[118px] items-center rounded-full border border-white/25 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.08))] p-1 text-text backdrop-blur-xl transition hover:border-white/35 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-1 top-1 h-1/2 rounded-full bg-gradient-to-b from-white/55 via-white/20 to-transparent blur-[1px] dark:from-white/20 dark:via-white/6"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-1 rounded-full border border-white/10"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-1 left-1 rounded-full transition-all duration-300 ${
          isDark
            ? 'w-[54px] bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(51,65,85,0.72))]'
            : 'w-[54px] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(226,232,240,0.8))]'
        }`}
        style={{
          transform: isDark ? 'translateX(54px)' : 'translateX(0)',
        }}
      />
      <span className="relative z-[1] grid w-full grid-cols-2 items-center">
        <span
          className={`flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors duration-300 ${
            isDark ? 'text-white/72' : 'text-slate-900'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
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
          <span>Light</span>
        </span>
        <span
          className={`flex items-center justify-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors duration-300 ${
            isDark ? 'text-white' : 'text-slate-700/78'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 14.5a8.5 8.5 0 1 1-11.3-11.3 7.4 7.4 0 0 0 11.3 11.3Z" />
          </svg>
          <span>Dark</span>
        </span>
      </span>
      <span
        className={`pointer-events-none absolute inset-y-1 left-1 z-[2] grid w-[54px] place-items-center rounded-full border text-[10px] transition-all duration-300 ${
          isDark
            ? 'translate-x-[54px] border-white/12 bg-[linear-gradient(135deg,rgba(51,65,85,0.96),rgba(15,23,42,0.9))] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]'
            : 'translate-x-0 border-white/50 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] text-slate-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]'
        }`}
      >
        {isDark ? (
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
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
            className="h-3.5 w-3.5"
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
      <span className="sr-only">{isDark ? 'Dark mode enabled' : 'Light mode enabled'}</span>
    </button>
  );
}

