import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

import { SalesOrderRequest } from '@/core/entities/salesOrderRequest';
import {
  CreateSalesOrderRequestInput,
  SalesOrderRequestRepository,
} from '@/core/ports/SalesOrderRequestRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { sortRecordsNewestFirst } from '@/lib/recordSort';

type SalesOrderRequestFirestore = Omit<SalesOrderRequest, 'id'>;

const toSalesOrderRequest = (id: string, data: SalesOrderRequestFirestore): SalesOrderRequest => ({
  id,
  ...data,
});

const SALES_ORDER_NAMESPACE_ID = 'main';
const poRequestsCollection = () =>
  collection(getFirebaseDb(), 'sales_order', SALES_ORDER_NAMESPACE_ID, 'sales_order_requests');

export const firebaseSalesOrderRequestRepository: SalesOrderRequestRepository = {
  async listAll() {
    const result = await getDocs(poRequestsCollection());
    return sortRecordsNewestFirst(
      result.docs.map((snap) =>
        toSalesOrderRequest(snap.id, snap.data() as SalesOrderRequestFirestore),
      ),
    );
  },
  async create(input: CreateSalesOrderRequestInput) {
    const now = new Date().toISOString();
    const payload: SalesOrderRequestFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(poRequestsCollection(), payload);
    return toSalesOrderRequest(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(poRequestsCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Purchase order request not found after update.');
    }
    return toSalesOrderRequest(snap.id, snap.data() as SalesOrderRequestFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(poRequestsCollection(), id));
  },
};
