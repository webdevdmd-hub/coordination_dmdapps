import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';

import { Project, ProjectStatus, ProjectStatusOverride } from '@/core/entities/project';
import { Task } from '@/core/entities/task';
import { getFirebaseDb } from '@/frameworks/firebase/client';

const SALES_NAMESPACE_ID = 'main';

const projectCollection = () =>
  collection(getFirebaseDb(), 'sales', SALES_NAMESPACE_ID, 'projects');
const taskCollection = () => collection(getFirebaseDb(), 'tasks');

const hasAssignedUser = (task: Pick<Task, 'assignedTo' | 'assignedUsers'>) =>
  Boolean(task.assignedTo?.trim()) || (task.assignedUsers ?? []).some((assigneeId) => !!assigneeId);

const toProject = (id: string, data: Omit<Project, 'id'>): Project => ({
  id,
  ...data,
});

export const getProjectStatusLabel = (status: ProjectStatus) => {
  switch (status) {
    case 'unassigned':
      return 'Unassigned';
    case 'not-started':
      return 'Pending';
    case 'in-progress':
      return 'In Progress';
    case 'on-hold':
      return 'On Hold';
    case 'completed':
      return 'Completed';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
};

export const deriveProjectStatusFromTasks = (
  tasks: Array<Pick<Task, 'status' | 'assignedTo' | 'assignedUsers'>>,
): ProjectStatus => {
  if (tasks.length === 0) {
    return 'not-started';
  }

  const allAssigned = tasks.every((task) => hasAssignedUser(task));
  if (!allAssigned) {
    return 'unassigned';
  }

  const allCompleted = tasks.every((task) => task.status === 'done');
  if (allCompleted) {
    return 'on-hold';
  }

  return 'in-progress';
};

export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  'unassigned',
  'not-started',
  'in-progress',
  'on-hold',
];

export const syncProjectWorkflowStatus = async (
  projectId: string,
  options?: {
    reason?: 'task-created' | 'task-updated' | 'task-deleted';
  },
) => {
  if (!projectId) {
    return null;
  }

  const projectRef = doc(projectCollection(), projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    return null;
  }

  const project = toProject(projectSnap.id, projectSnap.data() as Omit<Project, 'id'>);
  if (project.statusOverride) {
    if (project.status !== project.statusOverride) {
      const updatedAt = new Date().toISOString();
      await updateDoc(projectRef, { status: project.statusOverride, updatedAt });
      return {
        ...project,
        status: project.statusOverride,
        updatedAt,
      };
    }
    return project;
  }
  const tasksSnap = await getDocs(query(taskCollection(), where('projectId', '==', projectId)));
  const tasks = tasksSnap.docs.map((snap) => snap.data() as Omit<Task, 'id'>);

  const derivedStatus = deriveProjectStatusFromTasks(tasks);
  const nextStatus =
    options?.reason === 'task-created' && project.status === 'on-hold'
      ? 'in-progress'
      : derivedStatus;

  if (project.status !== nextStatus) {
    const updatedAt = new Date().toISOString();
    await updateDoc(projectRef, { status: nextStatus, updatedAt });
    return {
      ...project,
      status: nextStatus,
      updatedAt,
    };
  }

  return project;
};

export const setProjectStatusOverride = async (
  projectId: string,
  override: ProjectStatusOverride | null,
) => {
  const projectRef = doc(projectCollection(), projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    throw new Error('Project not found.');
  }
  const project = toProject(projectSnap.id, projectSnap.data() as Omit<Project, 'id'>);
  const tasksSnap = await getDocs(query(taskCollection(), where('projectId', '==', projectId)));
  const tasks = tasksSnap.docs.map((snap) => snap.data() as Omit<Task, 'id'>);
  const nextStatus = override ?? deriveProjectStatusFromTasks(tasks);
  const updatedAt = new Date().toISOString();

  await updateDoc(projectRef, {
    status: nextStatus,
    statusOverride: override,
    updatedAt,
  });

  return {
    ...project,
    status: nextStatus,
    statusOverride: override,
    updatedAt,
  };
};

export const syncProjectWorkflowStatusesForTaskMutation = async (options: {
  nextProjectId?: string;
  previousProjectId?: string;
  reason: 'task-created' | 'task-updated' | 'task-deleted';
}) => {
  const projectIds = Array.from(
    new Set([options.previousProjectId, options.nextProjectId].filter(Boolean)),
  ) as string[];

  const updates = await Promise.all(
    projectIds.map((projectId) =>
      syncProjectWorkflowStatus(projectId, {
        reason:
          options.reason === 'task-created' && projectId === options.nextProjectId
            ? 'task-created'
            : 'task-updated',
      }),
    ),
  );

  return updates.filter((project): project is Project => project !== null);
};
