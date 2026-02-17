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

import { CalendarEvent } from '@/core/entities/calendarEvent';
import { CalendarRepository, CreateCalendarEventInput } from '@/core/ports/CalendarRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type CalendarEventFirestore = Omit<CalendarEvent, 'id'>;

const toCalendarEvent = (id: string, data: CalendarEventFirestore): CalendarEvent => ({
  id,
  ...data,
});

const CRM_NAMESPACE_ID = 'main';
const crmCalendarCollection = () =>
  collection(getFirebaseDb(), 'crm', CRM_NAMESPACE_ID, 'crm_calendar');

export const firebaseCalendarRepository: CalendarRepository = {
  async listByOwner(ownerId) {
    const result = await getDocs(query(crmCalendarCollection(), where('ownerId', '==', ownerId)));
    return result.docs.map((snap) =>
      toCalendarEvent(snap.id, snap.data() as CalendarEventFirestore),
    );
  },
  async listAll() {
    const result = await getDocs(crmCalendarCollection());
    return result.docs.map((snap) =>
      toCalendarEvent(snap.id, snap.data() as CalendarEventFirestore),
    );
  },
  async create(input: CreateCalendarEventInput) {
    const now = new Date().toISOString();
    const payload: CalendarEventFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(crmCalendarCollection(), payload);
    return toCalendarEvent(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(crmCalendarCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Calendar event not found after update.');
    }
    return toCalendarEvent(snap.id, snap.data() as CalendarEventFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(crmCalendarCollection(), id));
  },
};
