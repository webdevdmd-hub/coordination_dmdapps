import { getMessaging, getToken, isSupported, Messaging, onMessage } from 'firebase/messaging';

import { getFirebaseApp } from '@/frameworks/firebase/client';

export const getFirebaseMessaging = async (): Promise<Messaging | null> => {
  const supported = await isSupported();
  if (!supported) {
    return null;
  }
  return getMessaging(getFirebaseApp());
};

export const requestPushToken = async (
  vapidKey: string,
  serviceWorkerRegistration: ServiceWorkerRegistration,
) => {
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return null;
  }
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration,
  });
  return token;
};

export const listenForForegroundMessages = async (handler: (payload: unknown) => void) => {
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return () => {};
  }
  return onMessage(messaging, handler);
};
