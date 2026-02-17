import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

import { getFirebaseDb } from '@/frameworks/firebase/client';

export type CreateQuotationRequestInput = {
  leadId: string;
  leadName: string;
  leadCompany: string;
  leadEmail: string;
  customerId: string;
  requestedBy: string;
  requestedByName: string;
  recipients: Array<{ id: string; name: string; roleKey: string }>;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  status?: 'new' | 'review' | 'approved' | 'rejected';
  notes?: string;
  createdAt?: string;
};

export type QuotationRequestTaskInput = {
  tag: string;
  status?: 'pending' | 'assigned' | 'done';
  assignedTo?: string;
  assignedName?: string;
  taskId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const SALES_NAMESPACE_ID = 'main';
const quotationRequestsCollection = () =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'quotation_requests');
const quotationRequestDoc = (id: string) =>
  doc(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'quotation_requests', id);
const quotationRequestTasksCollection = (id: string) =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'quotation_requests', id, 'tasks');

export const firebaseQuotationRequestRepository = {
  async create(input: CreateQuotationRequestInput) {
    const now = new Date().toISOString();
    const payload = {
      ...input,
      status: input.status ?? 'new',
      notes: input.notes ?? '',
      createdAt: input.createdAt ?? now,
    };
    const docRef = await addDoc(quotationRequestsCollection(), payload);
    return { id: docRef.id, ...payload };
  },
  async listAll() {
    const snapshot = await getDocs(quotationRequestsCollection());
    return snapshot.docs.map((snap) => ({
      id: snap.id,
      ...(snap.data() as Record<string, unknown>),
    }));
  },
  async update(id: string, updates: Record<string, unknown>) {
    const docRef = quotationRequestDoc(id);
    await updateDoc(docRef, updates);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Quotation request not found after update.');
    }
    return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
  },
  async delete(id: string) {
    await deleteDoc(quotationRequestDoc(id));
  },
  async addTasks(requestId: string, tasks: QuotationRequestTaskInput[]) {
    const now = new Date().toISOString();
    const collectionRef = quotationRequestTasksCollection(requestId);
    const created = await Promise.all(
      tasks.map(async (task) => {
        const payload = {
          ...task,
          status: task.status ?? 'pending',
          createdAt: task.createdAt ?? now,
          updatedAt: task.updatedAt ?? now,
        };
        const docRef = await addDoc(collectionRef, payload);
        return { id: docRef.id, ...payload };
      }),
    );
    return created;
  },
  async listTasks(requestId: string) {
    const snapshot = await getDocs(quotationRequestTasksCollection(requestId));
    return snapshot.docs.map((snap) => ({
      id: snap.id,
      ...(snap.data() as Record<string, unknown>),
    }));
  },
  async updateTask(requestId: string, taskId: string, updates: Record<string, unknown>) {
    const docRef = doc(
      getFirebaseDb(),
      'sales',
      SALES_NAMESPACE_ID,
      'quotation_requests',
      requestId,
      'tasks',
      taskId,
    );
    await updateDoc(docRef, updates);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Quotation request task not found after update.');
    }
    return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
  },
};
