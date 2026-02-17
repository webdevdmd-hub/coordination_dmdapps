'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { doc, setDoc } from 'firebase/firestore';

import { firebaseNotificationRepository } from '@/adapters/repositories/firebaseNotificationRepository';
import type { Notification } from '@/core/entities/notification';
import { useAuth } from '@/components/auth/AuthProvider';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { getPublicEnv } from '@/frameworks/firebase/config';
import { listenForForegroundMessages, requestPushToken } from '@/frameworks/firebase/messaging';

type NotificationContextValue = {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  pushPermission: NotificationPermission;
  enablePush: () => Promise<void>;
};

type ToastItem = {
  id: string;
  title: string;
  body: string;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const toToast = (notification: Notification): ToastItem => ({
  id: notification.id,
  title: notification.title,
  body: notification.body,
});

type AuthUser = ReturnType<typeof useAuth>['user'];

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <NotificationProviderInner key={user?.id ?? 'guest'} user={user}>
      {children}
    </NotificationProviderInner>
  );
}

function NotificationProviderInner({
  user,
  children,
}: {
  user: AuthUser;
  children: React.ReactNode;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof window === 'undefined' || typeof Notification === 'undefined'
      ? 'default'
      : Notification.permission,
  );
  const seenIdsRef = useRef(new Set<string>());
  const initialLoadRef = useRef(true);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications],
  );

  useEffect(() => {
    if (!user) {
      return;
    }
    const unsubscribe = firebaseNotificationRepository.subscribeForUser(
      user.id,
      (items) => {
        const newItems = items.filter((item) => !seenIdsRef.current.has(item.id) && !item.readAt);
        items.forEach((item) => seenIdsRef.current.add(item.id));
        setNotifications(items);
        if (!initialLoadRef.current) {
          setToasts((prev) => {
            const next = [...prev];
            newItems.forEach((notification) => {
              next.push(toToast(notification));
            });
            return next;
          });
        }
        initialLoadRef.current = false;
      },
      60,
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== toast.id));
      }, 6000),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [toasts]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (typeof Notification === 'undefined') {
      return;
    }
    if (Notification.permission !== 'granted') {
      return;
    }
    const register = async () => {
      if (!('serviceWorker' in navigator)) {
        return;
      }
      const vapidKey = getPublicEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY');
      if (!vapidKey) {
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const token = await requestPushToken(vapidKey, registration);
        if (!token) {
          return;
        }
        const tokenRef = doc(getFirebaseDb(), 'userDevices', user.id, 'tokens', token);
        await setDoc(
          tokenRef,
          {
            token,
            platform: navigator.userAgent,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } catch {
        // Silently ignore push registration errors.
      }
    };
    register();
  }, [user]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    const attach = async () => {
      unsubscribe = await listenForForegroundMessages(() => {
        // Firestore listener will display the toast; no-op here for now.
      });
    };
    attach();
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const markRead = useCallback(async (id: string) => {
    await firebaseNotificationRepository.markRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) {
      return;
    }
    const unreadIds = notifications.filter((item) => !item.readAt).map((item) => item.id);
    if (unreadIds.length === 0) {
      return;
    }
    await Promise.all(unreadIds.map((id) => firebaseNotificationRepository.markRead(id)));
  }, [notifications, user]);

  const enablePush = useCallback(async () => {
    if (!user) {
      return;
    }
    if (typeof Notification === 'undefined') {
      return;
    }
    if (!('serviceWorker' in navigator)) {
      return;
    }
    const permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission !== 'granted') {
      return;
    }
    const vapidKey = getPublicEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY');
    if (!vapidKey) {
      return;
    }
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await requestPushToken(vapidKey, registration);
    if (!token) {
      return;
    }
    const tokenRef = doc(getFirebaseDb(), 'userDevices', user.id, 'tokens', token);
    await setDoc(
      tokenRef,
      {
        token,
        platform: navigator.userAgent,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }, [user]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      pushPermission,
      enablePush,
    }),
    [notifications, unreadCount, markRead, markAllRead, pushPermission, enablePush],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="fixed right-6 top-20 z-[60] flex w-[320px] max-w-[85vw] flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rounded-2xl border border-border/60 bg-surface/95 p-4 shadow-floating backdrop-blur"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
              Notification
            </p>
            <p className="mt-2 text-sm font-semibold text-text">{toast.title}</p>
            <p className="mt-1 text-xs text-muted">{toast.body}</p>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
              className="mt-3 rounded-full border border-border/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider.');
  }
  return context;
};
