import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

import {
  QuotationRequest,
  QuotationRequestTask,
  normalizeQuotationRequestStatus,
} from '@/core/entities/quotationRequest';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { sortRecordsNewestFirst } from '@/lib/recordSort';

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
  status?: 'new' | 'pending' | 'review' | 'completed';
  notes?: string;
  createdAt?: string;
};

export type QuotationRequestTaskInput = {
  tag: string;
  status?: 'pending' | 'assigned' | 'done';
  assignedTo?: string;
  assignedName?: string;
  taskId?: string;
  estimateNumber?: string;
  estimateAmount?: number;
  createdAt?: string;
  updatedAt?: string;
};

type QuotationRequestFirestore = Omit<QuotationRequest, 'id'>;
type QuotationRequestTaskFirestore = Omit<QuotationRequestTask, 'id'>;

const toQuotationRequest = (id: string, data: QuotationRequestFirestore): QuotationRequest => ({
  id,
  ...data,
  status: normalizeQuotationRequestStatus(data.status),
});

const toQuotationRequestTask = (
  id: string,
  data: QuotationRequestTaskFirestore,
): QuotationRequestTask => ({
  id,
  ...data,
});

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
    const payload: QuotationRequestFirestore = {
      ...input,
      status: normalizeQuotationRequestStatus(input.status),
      notes: input.notes ?? '',
      createdAt: input.createdAt ?? now,
    };
    const docRef = await addDoc(quotationRequestsCollection(), payload);
    return toQuotationRequest(docRef.id, payload);
  },
  async listAll() {
    const snapshot = await getDocs(quotationRequestsCollection());
    return sortRecordsNewestFirst(
      snapshot.docs.map((snap) =>
        toQuotationRequest(snap.id, snap.data() as QuotationRequestFirestore),
      ),
    );
  },
  async getById(id: string) {
    const snap = await getDoc(quotationRequestDoc(id));
    if (!snap.exists()) {
      return null;
    }
    return toQuotationRequest(snap.id, snap.data() as QuotationRequestFirestore);
  },
  async update(id: string, updates: Record<string, unknown>) {
    const docRef = quotationRequestDoc(id);
    await updateDoc(docRef, updates);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Quotation request not found after update.');
    }
    return toQuotationRequest(snap.id, snap.data() as QuotationRequestFirestore);
  },
  async delete(id: string) {
    await deleteDoc(quotationRequestDoc(id));
  },
  async addTasks(requestId: string, tasks: QuotationRequestTaskInput[]) {
    const now = new Date().toISOString();
    const collectionRef = quotationRequestTasksCollection(requestId);
    const created = await Promise.all(
      tasks.map(async (task) => {
        const payload: QuotationRequestTaskFirestore = {
          ...task,
          status: task.status ?? 'pending',
          createdAt: task.createdAt ?? now,
          updatedAt: task.updatedAt ?? now,
        };
        const docRef = await addDoc(collectionRef, payload);
        return toQuotationRequestTask(docRef.id, payload);
      }),
    );
    return created;
  },
  async listTasks(requestId: string) {
    const snapshot = await getDocs(quotationRequestTasksCollection(requestId));
    return sortRecordsNewestFirst(
      snapshot.docs.map((snap) =>
        toQuotationRequestTask(snap.id, snap.data() as QuotationRequestTaskFirestore),
      ),
    );
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
    return toQuotationRequestTask(snap.id, snap.data() as QuotationRequestTaskFirestore);
  },
  async deleteTask(requestId: string, taskId: string) {
    const docRef = doc(
      getFirebaseDb(),
      'sales',
      SALES_NAMESPACE_ID,
      'quotation_requests',
      requestId,
      'tasks',
      taskId,
    );
    await deleteDoc(docRef);
  },
};
