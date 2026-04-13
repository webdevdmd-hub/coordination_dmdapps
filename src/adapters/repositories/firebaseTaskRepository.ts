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
import { syncProjectWorkflowStatusesForTaskMutation } from '@/lib/projectStatusWorkflow';
import { sortRecordsNewestFirst } from '@/lib/recordSort';

type TaskFirestore = Omit<Task, 'id'>;

const toTask = (id: string, data: TaskFirestore): Task => ({
  id,
  ...data,
});

const taskCollection = () => collection(getFirebaseDb(), 'tasks');

export const firebaseTaskRepository: TaskRepository = {
  async listAll() {
    const result = await getDocs(taskCollection());
    return sortRecordsNewestFirst(
      result.docs.map((snap) => toTask(snap.id, snap.data() as TaskFirestore)),
    );
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
    return sortRecordsNewestFirst(Array.from(map.values()));
  },
  async listForProject(projectId) {
    const result = await getDocs(query(taskCollection(), where('projectId', '==', projectId)));
    return sortRecordsNewestFirst(
      result.docs.map((snap) => toTask(snap.id, snap.data() as TaskFirestore)),
    );
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
    if (payload.projectId) {
      await syncProjectWorkflowStatusesForTaskMutation({
        nextProjectId: payload.projectId,
        reason: 'task-created',
      });
    }
    return toTask(docRef.id, payload);
  },
  async update(id, updates) {
    const docRef = doc(taskCollection(), id);
    const previousSnap = await getDoc(docRef);
    if (!previousSnap.exists()) {
      throw new Error('Task not found.');
    }
    const previousTask = toTask(previousSnap.id, previousSnap.data() as TaskFirestore);
    const rest = { ...updates };
    delete (rest as { id?: string }).id;
    await updateDoc(docRef, rest);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Task not found after update.');
    }
    const updatedTask = toTask(snap.id, snap.data() as TaskFirestore);
    const assignmentChanged =
      previousTask.assignedTo !== updatedTask.assignedTo ||
      (previousTask.assignedUsers ?? []).join('|') !== (updatedTask.assignedUsers ?? []).join('|');
    const workflowInputsChanged =
      previousTask.projectId !== updatedTask.projectId ||
      previousTask.status !== updatedTask.status ||
      assignmentChanged;
    if (workflowInputsChanged) {
      await syncProjectWorkflowStatusesForTaskMutation({
        previousProjectId: previousTask.projectId,
        nextProjectId: updatedTask.projectId,
        reason: 'task-updated',
      });
    }
    return updatedTask;
  },
  async delete(id) {
    const docRef = doc(taskCollection(), id);
    const snap = await getDoc(docRef);
    const existingTask = snap.exists() ? toTask(snap.id, snap.data() as TaskFirestore) : null;
    await deleteDoc(docRef);
    if (existingTask?.projectId) {
      await syncProjectWorkflowStatusesForTaskMutation({
        previousProjectId: existingTask.projectId,
        reason: 'task-deleted',
      });
    }
  },
};
