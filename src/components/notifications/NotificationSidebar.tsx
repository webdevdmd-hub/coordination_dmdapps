'use client';

import { useNotifications } from '@/components/notifications/NotificationProvider';

export function NotificationSidebar() {
  const { notifications, markRead } = useNotifications();
  const latest = notifications.slice(0, 5);

  return (
    <div className="rounded-2xl border border-border/60 bg-bg/70 p-3 text-[11px] sm:p-4 sm:text-xs">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs">
        Notifications
      </p>
      <div className="mt-3 space-y-2">
        {latest.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-bg/80 px-3 py-2 text-[11px] text-muted sm:px-3 sm:py-2 sm:text-xs">
            No updates yet.
          </div>
        ) : (
          latest.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => markRead(item.id)}
              className={`w-full rounded-xl border border-border/60 px-3 py-2 text-left text-[11px] transition hover:bg-hover/80 sm:px-3 sm:py-2 sm:text-xs ${
                item.readAt ? 'bg-bg/60 text-muted' : 'bg-bg/90 text-text'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted sm:text-[11px] sm:text-text">
                {item.title}
              </p>
              <p className="mt-1 text-[11px] sm:text-xs">{item.body}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
