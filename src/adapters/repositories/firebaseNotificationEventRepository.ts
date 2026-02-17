import { addDoc, collection } from 'firebase/firestore';

import type { NotificationEvent } from '@/core/entities/notification';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type NotificationEventInput = Omit<NotificationEvent, 'id' | 'createdAt'> & {
  createdAt?: string;
};

const notificationEventCollection = () => collection(getFirebaseDb(), 'notificationEvents');

export const firebaseNotificationEventRepository = {
  async create(input: NotificationEventInput) {
    const payload = {
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const ref = await addDoc(notificationEventCollection(), payload);
    return { id: ref.id, ...payload };
  },
};
