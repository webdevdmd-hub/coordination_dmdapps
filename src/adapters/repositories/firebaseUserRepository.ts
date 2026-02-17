import { addDoc, collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

import { User } from '@/core/entities/user';
import { CreateUserInput, UserRepository } from '@/core/ports/UserRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type UserFirestore = Omit<User, 'id'>;

const toUser = (id: string, data: UserFirestore & { permissions?: unknown }): User => {
  const { permissions, ...rest } = data;
  void permissions;
  return {
    id,
    ...rest,
  };
};

export const firebaseUserRepository: UserRepository = {
  async getById(id) {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'users', id));
    if (!snap.exists()) {
      return null;
    }
    return toUser(snap.id, snap.data() as UserFirestore);
  },
  async listAll() {
    const db = getFirebaseDb();
    const result = await getDocs(collection(db, 'users'));
    return result.docs.map((snap) => toUser(snap.id, snap.data() as UserFirestore));
  },
  async create(input: CreateUserInput) {
    const db = getFirebaseDb();
    const { id, ...payloadInput } = input;
    const payload: UserFirestore = {
      ...payloadInput,
      active: true,
      createdAt: new Date().toISOString(),
    };
    if (id) {
      const docRef = doc(db, 'users', id);
      await setDoc(docRef, payload);
      return toUser(docRef.id, payload);
    }
    const docRef = await addDoc(collection(db, 'users'), payload);
    return toUser(docRef.id, payload);
  },
  async update(id, updates) {
    const db = getFirebaseDb();
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(db, 'users', id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('User not found after update.');
    }
    return toUser(snap.id, snap.data() as UserFirestore);
  },
  async deactivate(id) {
    const db = getFirebaseDb();
    await updateDoc(doc(db, 'users', id), { active: false });
  },
};
