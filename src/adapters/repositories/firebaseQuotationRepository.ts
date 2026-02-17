import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

import { Quotation } from '@/core/entities/quotation';
import { CreateQuotationInput, QuotationRepository } from '@/core/ports/QuotationRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type QuotationFirestore = Omit<Quotation, 'id'>;

const toQuotation = (id: string, data: QuotationFirestore): Quotation => ({
  id,
  ...data,
});

const SALES_NAMESPACE_ID = 'main';
const quotationCollection = () =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'quatations');

export const firebaseQuotationRepository: QuotationRepository = {
  async listAll() {
    const result = await getDocs(quotationCollection());
    return result.docs.map((snap) => toQuotation(snap.id, snap.data() as QuotationFirestore));
  },
  async listForUser(userId, role) {
    const assignedQuery = query(quotationCollection(), where('assignedTo', '==', userId));
    const sharedQuery = query(quotationCollection(), where('sharedRoles', 'array-contains', role));
    const [assignedSnap, sharedSnap] = await Promise.all([
      getDocs(assignedQuery),
      getDocs(sharedQuery),
    ]);
    const map = new Map<string, Quotation>();
    assignedSnap.docs.forEach((snap) =>
      map.set(snap.id, toQuotation(snap.id, snap.data() as QuotationFirestore)),
    );
    sharedSnap.docs.forEach((snap) =>
      map.set(snap.id, toQuotation(snap.id, snap.data() as QuotationFirestore)),
    );
    return Array.from(map.values());
  },
  async create(input: CreateQuotationInput) {
    const now = new Date().toISOString();
    const payload: QuotationFirestore = {
      ...input,
      subtotal: input.subtotal ?? 0,
      taxAmount: input.taxAmount ?? 0,
      total: input.total ?? 0,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(quotationCollection(), payload);
    return toQuotation(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(quotationCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Quotation not found after update.');
    }
    return toQuotation(snap.id, snap.data() as QuotationFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(quotationCollection(), id));
  },
};
