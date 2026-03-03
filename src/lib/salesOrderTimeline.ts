import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';

import { getFirebaseDb } from '@/frameworks/firebase/client';

const SALES_ORDER_NAMESPACE_ID = 'main';

export type SalesOrderTimelineEventType = 'sent_to_store' | 'store_received';

export type SalesOrderTimelineEvent = {
  id: string;
  requestId: string;
  requestNo: string;
  projectId: string;
  type: SalesOrderTimelineEventType;
  note: string;
  actorId: string;
  actorName: string;
  date: string;
  createdAt: string;
};

type CreateSalesOrderTimelineEventInput = Omit<SalesOrderTimelineEvent, 'id' | 'createdAt'> & {
  createdAt?: string;
};

const timelineCollection = () =>
  collection(getFirebaseDb(), 'sales_order', SALES_ORDER_NAMESPACE_ID, 'sales_order_request_logs');

export const addSalesOrderTimelineEvent = async (input: CreateSalesOrderTimelineEventInput) => {
  const now = new Date().toISOString();
  await addDoc(timelineCollection(), {
    ...input,
    createdAt: input.createdAt ?? now,
  });
};

export const listSalesOrderTimelineEvents = async (requestId: string) => {
  const snapshot = await getDocs(query(timelineCollection(), where('requestId', '==', requestId)));
  return snapshot.docs
    .map((docItem) => ({
      id: docItem.id,
      ...(docItem.data() as Omit<SalesOrderTimelineEvent, 'id'>),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
};
