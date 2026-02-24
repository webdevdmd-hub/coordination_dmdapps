'use client';

import { useEffect, useRef, useState } from 'react';

import { useNotifications } from '@/components/notifications/NotificationProvider';

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, markRead, pushPermission, enablePush } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-xl p-2 text-muted transition hover:bg-[var(--surface-muted)] hover:text-text"
        aria-label="Notifications"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+12px)] z-40 w-[260px] rounded-2xl border border-border/60 bg-surface/95 p-3 text-xs text-text shadow-floating backdrop-blur sm:left-auto sm:right-0 sm:w-[320px] sm:p-4 sm:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs">
              Notifications
            </p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-full border border-border/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 sm:px-3 sm:text-[10px]"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {pushPermission !== 'granted' ? (
            <div className="mt-3 rounded-xl border border-amber-200/40 bg-amber-500/10 p-3 text-[11px] text-amber-100 sm:text-xs">
              <p className="font-semibold uppercase tracking-[0.18em] text-amber-200 text-[10px] sm:text-xs">
                Enable push alerts
              </p>
              <p className="mt-2 text-[10px] text-amber-100/90 sm:text-[11px]">
                Allow browser notifications for task, timer, and calendar updates.
              </p>
              <button
                type="button"
                onClick={enablePush}
                className="mt-3 rounded-full border border-amber-200/50 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-100 transition hover:bg-amber-500/20 sm:px-3 sm:text-[10px]"
              >
                Enable push
              </button>
            </div>
          ) : null}

          <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto sm:mt-4 sm:max-h-[320px] sm:space-y-3">
            {notifications.length === 0 ? (
              <div className="rounded-xl border border-border/60 bg-bg/70 px-3 py-2 text-[11px] text-muted sm:text-xs">
                No notifications yet.
              </div>
            ) : (
              notifications.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => markRead(item.id)}
                  className={`w-full rounded-xl border border-border/60 px-3 py-2 text-left text-[11px] transition hover:bg-hover/80 sm:text-xs ${
                    item.readAt ? 'bg-bg/50 text-muted' : 'bg-bg/80 text-text'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] sm:text-xs">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] sm:text-xs">{item.body}</p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

