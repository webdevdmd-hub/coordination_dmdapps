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

import { Task } from '@/core/entities/task';
import { CreateTaskInput, TaskRepository } from '@/core/ports/TaskRepository';
import { getFirebaseDb } from '@/frameworks/firebase/client';

type TaskFirestore = Omit<Task, 'id'>;

const toTask = (id: string, data: TaskFirestore): Task => ({
  id,
  ...data,
});

const taskCollection = () => collection(getFirebaseDb(), 'tasks');

export const firebaseTaskRepository: TaskRepository = {
  async listAll() {
    const result = await getDocs(taskCollection());
    return result.docs.map((snap) => toTask(snap.id, snap.data() as TaskFirestore));
  },
  async listForUser(userId) {
    const assignedQuery = query(taskCollection(), where('assignedTo', '==', userId));
    const assignedUsersQuery = query(
      taskCollection(),
      where('assignedUsers', 'array-contains', userId),
    );
    const createdQuery = query(taskCollection(), where('createdBy', '==', userId));
    const [assignedSnap, assignedUsersSnap, createdSnap] = await Promise.all([
      getDocs(assignedQuery),
      getDocs(assignedUsersQuery),
      getDocs(createdQuery),
    ]);
    const map = new Map<string, Task>();
    assignedSnap.docs.forEach((snap) =>
      map.set(snap.id, toTask(snap.id, snap.data() as TaskFirestore)),
    );
    assignedUsersSnap.docs.forEach((snap) =>
      map.set(snap.id, toTask(snap.id, snap.data() as TaskFirestore)),
    );
    createdSnap.docs.forEach((snap) =>
      map.set(snap.id, toTask(snap.id, snap.data() as TaskFirestore)),
    );
    return Array.from(map.values());
  },
  async listForProject(projectId) {
    const result = await getDocs(query(taskCollection(), where('projectId', '==', projectId)));
    return result.docs.map((snap) => toTask(snap.id, snap.data() as TaskFirestore));
  },
  async create(input: CreateTaskInput) {
    const now = new Date().toISOString();
    const payload: TaskFirestore = {
      ...input,
      assignedUsers: input.assignedUsers ?? (input.assignedTo ? [input.assignedTo] : []),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const docRef = await addDoc(taskCollection(), payload);
    return toTask(docRef.id, payload);
  },
  async update(id, updates) {
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    const docRef = doc(taskCollection(), id);
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Task not found after update.');
    }
    return toTask(snap.id, snap.data() as TaskFirestore);
  },
  async delete(id) {
    await deleteDoc(doc(taskCollection(), id));
  },
};
