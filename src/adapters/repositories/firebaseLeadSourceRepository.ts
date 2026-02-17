import { addDoc, collection, getDocs, orderBy, query } from 'firebase/firestore';

import { getFirebaseDb } from '@/frameworks/firebase/client';

export type LeadSource = {
  id: string;
  name: string;
};

type LeadSourceFirestore = {
  name: string;
  createdAt: string;
  createdBy: string;
};

const CRM_NAMESPACE_ID = 'main';
const leadSourceCollection = () =>
  collection(getFirebaseDb(), 'crm', CRM_NAMESPACE_ID, 'lead_sources');

export const firebaseLeadSourceRepository = {
  async listAll() {
    const result = await getDocs(query(leadSourceCollection(), orderBy('name', 'asc')));
    return result.docs.map((snap) => ({
      id: snap.id,
      name: (snap.data() as LeadSourceFirestore).name,
    }));
  },
  async create(name: string, createdBy: string) {
    const payload: LeadSourceFirestore = {
      name,
      createdAt: new Date().toISOString(),
      createdBy,
    };
    const docRef = await addDoc(leadSourceCollection(), payload);
    return { id: docRef.id, name };
  },
};
