import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';

import { PurchaseOrderRequest } from '@/core/entities/purchaseOrderRequest';
import {
  CreatePurchaseOrderRequestInput,
  PurchaseOrderRequestRepository,
} from '@/core/ports/PurchaseOrderRequestRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type PurchaseOrderRequestFirestore = Omit<PurchaseOrderRequest, 'id'>;

const toPurchaseOrderRequest = (
  id: string,
  data: PurchaseOrderRequestFirestore,
): PurchaseOrderRequest => ({
  id,
  ...data,
});

const SALES_ORDER_NAMESPACE_ID = 'main';
const poRequestsCollection = () =>
  collection(getFirebaseDb(), 'sales_order', SALES_ORDER_NAMESPACE_ID, 'po_requests');

export const firebasePurchaseOrderRequestRepository: PurchaseOrderRequestRepository = {
  async listAll() {
    const result = await getDocs(poRequestsCollection());
    return result.docs.map((snap) =>
      toPurchaseOrderRequest(snap.id, snap.data() as PurchaseOrderRequestFirestore),
    );
  },
  async create(input: CreatePurchaseOrderRequestInput) {
    const now = new Date().toISOString();
    const payload: PurchaseOrderRequestFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(poRequestsCollection(), payload);
    return toPurchaseOrderRequest(docRef.id, payload);
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
    return toPurchaseOrderRequest(snap.id, snap.data() as PurchaseOrderRequestFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(poRequestsCollection(), id));
  },
};
