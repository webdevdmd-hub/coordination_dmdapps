import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';

import type { Notification } from '@/core/entities/notification';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type NotificationFirestore = Omit<Notification, 'id'>;

const toNotification = (id: string, data: NotificationFirestore): Notification => ({
  id,
  ...data,
});

const notificationCollection = () => collection(getFirebaseDb(), 'notifications');

export const firebaseNotificationRepository = {
  subscribeForUser(
    userId: string,
    onChange: (notifications: Notification[]) => void,
    maxItems: number = 50,
  ) {
    const q = query(notificationCollection(), where('userId', '==', userId));
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map((snap) => toNotification(snap.id, snap.data() as NotificationFirestore))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, maxItems);
      onChange(list);
    });
  },
  async markRead(id: string) {
    await updateDoc(doc(notificationCollection(), id), {
      readAt: new Date().toISOString(),
    });
  },
  async markAllRead(userId: string, unreadIds: string[]) {
    if (unreadIds.length === 0) {
      return;
    }
    await Promise.all(unreadIds.map((id) => this.markRead(id)));
  },
};
