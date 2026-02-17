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

import { Lead, LeadActivity } from '@/core/entities/lead';
import { CreateLeadInput, LeadRepository } from '@/core/ports/LeadRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type LeadFirestore = Omit<Lead, 'id'>;

const toLead = (id: string, data: LeadFirestore): Lead => ({
  id,
  ...data,
});

const CRM_NAMESPACE_ID = 'main';
const crmLeadsCollection = () => collection(getFirebaseDb(), 'crm', CRM_NAMESPACE_ID, 'crm_leads');
const activitiesCollection = (leadId: string) =>
  collection(getFirebaseDb(), 'crm', CRM_NAMESPACE_ID, 'crm_leads', leadId, 'activities');

export const firebaseLeadRepository: LeadRepository = {
  async getById(id) {
    const snap = await getDoc(doc(crmLeadsCollection(), id));
    if (!snap.exists()) {
      return null;
    }
    return toLead(snap.id, snap.data() as LeadFirestore);
  },
  async listByOwner(ownerId) {
    const result = await getDocs(query(crmLeadsCollection(), where('ownerId', '==', ownerId)));
    return result.docs.map((snap) => toLead(snap.id, snap.data() as LeadFirestore));
  },
  async listAll() {
    const result = await getDocs(crmLeadsCollection());
    return result.docs.map((snap) => toLead(snap.id, snap.data() as LeadFirestore));
  },
  async create(input: CreateLeadInput) {
    const now = new Date().toISOString();
    const payload: LeadFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      lastTouchedAt: input.lastTouchedAt ?? now,
    };
    const docRef = await addDoc(crmLeadsCollection(), payload);
    return toLead(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(crmLeadsCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Lead not found after update.');
    }
    return toLead(snap.id, snap.data() as LeadFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(crmLeadsCollection(), id));
  },
  async listActivities(leadId) {
    const result = await getDocs(activitiesCollection(leadId));
    return result.docs
      .map((snap) => ({
        id: snap.id,
        ...(snap.data() as Omit<LeadActivity, 'id'>),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  async addActivity(leadId, activity) {
    const payload: Omit<LeadActivity, 'id'> = { ...activity };
    const docRef = await addDoc(activitiesCollection(leadId), payload);
    return { id: docRef.id, ...payload };
  },
};
