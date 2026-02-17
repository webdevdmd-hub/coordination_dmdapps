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

import { Customer } from '@/core/entities/customer';
import { CreateCustomerInput, CustomerRepository } from '@/core/ports/CustomerRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type CustomerFirestore = Omit<Customer, 'id'>;

const toCustomer = (id: string, data: CustomerFirestore): Customer => ({
  id,
  ...data,
});

const SALES_NAMESPACE_ID = 'main';
const customerCollection = () =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'customers');

export const findCustomerByLeadId = async (leadId: string) => {
  if (!leadId) {
    return null;
  }
  const result = await getDocs(query(customerCollection(), where('leadId', '==', leadId)));
  if (result.empty) {
    return null;
  }
  const snap = result.docs[0];
  return toCustomer(snap.id, snap.data() as CustomerFirestore);
};

export const findCustomerByEmail = async (email: string) => {
  if (!email) {
    return null;
  }
  const result = await getDocs(query(customerCollection(), where('email', '==', email)));
  if (result.empty) {
    return null;
  }
  const snap = result.docs[0];
  return toCustomer(snap.id, snap.data() as CustomerFirestore);
};

export const firebaseCustomerRepository: CustomerRepository = {
  async listAll() {
    const result = await getDocs(customerCollection());
    return result.docs.map((snap) => toCustomer(snap.id, snap.data() as CustomerFirestore));
  },
  async listForUser(userId, role) {
    const assignedQuery = query(customerCollection(), where('assignedTo', '==', userId));
    const sharedQuery = query(customerCollection(), where('sharedRoles', 'array-contains', role));
    const [assignedSnap, sharedSnap] = await Promise.all([
      getDocs(assignedQuery),
      getDocs(sharedQuery),
    ]);
    const map = new Map<string, Customer>();
    assignedSnap.docs.forEach((snap) =>
      map.set(snap.id, toCustomer(snap.id, snap.data() as CustomerFirestore)),
    );
    sharedSnap.docs.forEach((snap) =>
      map.set(snap.id, toCustomer(snap.id, snap.data() as CustomerFirestore)),
    );
    return Array.from(map.values());
  },
  async create(input: CreateCustomerInput) {
    const now = new Date().toISOString();
    const payload: CustomerFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(customerCollection(), payload);
    return toCustomer(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(customerCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Customer not found after update.');
    }
    return toCustomer(snap.id, snap.data() as CustomerFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(customerCollection(), id));
  },
};
