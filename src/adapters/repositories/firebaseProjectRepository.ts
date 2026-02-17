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

import { Project } from '@/core/entities/project';
import { CreateProjectInput, ProjectRepository } from '@/core/ports/ProjectRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type ProjectFirestore = Omit<Project, 'id'>;

const toProject = (id: string, data: ProjectFirestore): Project => ({
  id,
  ...data,
});

const SALES_NAMESPACE_ID = 'main';
const projectCollection = () =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'projects');

export const firebaseProjectRepository: ProjectRepository = {
  async listAll() {
    const result = await getDocs(projectCollection());
    return result.docs.map((snap) => toProject(snap.id, snap.data() as ProjectFirestore));
  },
  async listForUser(userId, role) {
    const assignedQuery = query(projectCollection(), where('assignedTo', '==', userId));
    const sharedQuery = query(projectCollection(), where('sharedRoles', 'array-contains', role));
    const [assignedSnap, sharedSnap] = await Promise.all([
      getDocs(assignedQuery),
      getDocs(sharedQuery),
    ]);
    const map = new Map<string, Project>();
    assignedSnap.docs.forEach((snap) =>
      map.set(snap.id, toProject(snap.id, snap.data() as ProjectFirestore)),
    );
    sharedSnap.docs.forEach((snap) =>
      map.set(snap.id, toProject(snap.id, snap.data() as ProjectFirestore)),
    );
    return Array.from(map.values());
  },
  async create(input: CreateProjectInput) {
    const now = new Date().toISOString();
    const payload: ProjectFirestore = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(projectCollection(), payload);
    return toProject(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(projectCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Project not found after update.');
    }
    return toProject(snap.id, snap.data() as ProjectFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(projectCollection(), id));
  },
};
