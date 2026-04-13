'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, onSnapshot } from 'firebase/firestore';

import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseQuotationRequestRepository } from '@/adapters/repositories/firebaseQuotationRequestRepository';
import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { LeadActivityType } from '@/core/entities/lead';
import { Task, TaskPriority, TaskRecurrence, TaskStatus } from '@/core/entities/task';
import { Project } from '@/core/entities/project';
import { User } from '@/core/entities/user';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { getModuleCacheEntry, setModuleCacheEntry } from '@/lib/moduleDataCache';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import { filterUsersByRole, hasUserVisibilityAccess } from '@/lib/roleVisibility';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { FilterDropdown } from '@/components/ui/FilterDropdown';
import {
  areSameRecipientSets,
  buildRecipientList,
  emitNotificationEventSafe,
  getModuleNotificationPermissions,
} from '@/lib/notifications';

type TaskFormState = {
  title: string;
  description: string;
  assignedTo: string;
  assignedUsers: string[];
  status: TaskStatus;
  priority: TaskPriority;
  recurrence: TaskRecurrence;
  quotationNumber: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  parentTaskId: string;
  projectId: string;
  referenceModelNumber: string;
  estimateNumber: string;
  estimateAmount: string;
  isRevision: boolean;
  revisionNumber: string;
};

type TaskViewMode = 'list' | 'cards' | 'kanban';

const taskViewOptions: Array<{ value: TaskViewMode; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'cards', label: 'Cards' },
  { value: 'kanban', label: 'Kanban' },
];
const taskStatusFilterOptions = ['all', 'todo', 'in-progress', 'review', 'done'] as const;

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const boardPriorityColor: Record<TaskPriority, string> = {
  low: 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  medium: 'border border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
  high: 'border border-orange-400/30 bg-orange-400/12 text-orange-200',
  urgent: 'border border-rose-400/35 bg-rose-400/14 text-rose-200',
};

const taskStatusStyles: Record<TaskStatus, string> = {
  todo: 'border border-slate-500/30 bg-slate-400/10 text-slate-200',
  'in-progress': 'border border-sky-400/35 bg-sky-400/12 text-sky-200',
  review: 'border border-amber-400/35 bg-amber-400/12 text-amber-200',
  done: 'border border-emerald-400/35 bg-emerald-400/12 text-emerald-200',
};

const taskBadgeSizeClass = 'w-[140px] justify-center text-center whitespace-nowrap';
const taskSelectSizeClass = 'w-[140px] text-center text-center-last';

const TASK_MODAL_DRAFT_STORAGE_KEY = 'tasks-modal-draft';
const TASK_LIST_PAGE_SIZE_STORAGE_KEY = 'tasks-list-page-size';
const TASK_VISIBLE_COLUMNS_STORAGE_KEY = 'tasks-visible-columns';

const todayKey = () => new Date().toISOString().slice(0, 10);

const formatDate = (value: string) => {
  if (!value) {
    return '-';
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const normalizeStatus = (value: string): TaskStatus => {
  if (value === 'todo' || value === 'in-progress' || value === 'review' || value === 'done') {
    return value;
  }
  if (value === 'blocked') {
    return 'review';
  }
  return 'todo';
};

type TaskListColumnKey =
  | 'assignee'
  | 'task'
  | 'customer'
  | 'linked'
  | 'date'
  | 'status'
  | 'priority'
  | 'time'
  | 'action';

const TASK_LIST_COLUMNS: Array<{
  key: TaskListColumnKey;
  label: string;
  width: string;
}> = [
  { key: 'assignee', label: 'Assigned To', width: '1.15fr' },
  { key: 'task', label: 'Task Name', width: '1.45fr' },
  { key: 'customer', label: 'Customer', width: '1.15fr' },
  { key: 'linked', label: 'Linked Record', width: '1.1fr' },
  { key: 'date', label: 'Date', width: '0.9fr' },
  { key: 'status', label: 'Status', width: '0.9fr' },
  { key: 'priority', label: 'Priority', width: '0.9fr' },
  { key: 'time', label: 'Time', width: '0.75fr' },
  { key: 'action', label: 'Action', width: '0.95fr' },
];

const DEFAULT_VISIBLE_TASK_COLUMNS: TaskListColumnKey[] = TASK_LIST_COLUMNS.map(
  (column) => column.key,
);
const TASK_LIST_PAGE_SIZE_OPTIONS = [10, 25, 50];

const buildAssignedRecipients = (
  assignedTo: string,
  assignedUsers: string[] | undefined,
  actorId: string,
) => buildRecipientList(assignedTo, assignedUsers ?? [], actorId);

const getTaskNotificationPermissions = (task: Pick<Task, 'projectId' | 'quotationRequestId'>) => {
  if (task.quotationRequestId) {
    return getModuleNotificationPermissions('quotationRequests');
  }
  if (task.projectId) {
    return getModuleNotificationPermissions('projects');
  }
  return undefined;
};

const isAssignedTask = (task?: Pick<Task, 'assignedTo' | 'assignedUsers'> | null) =>
  !!task &&
  (Boolean(task.assignedTo?.trim()) ||
    (task.assignedUsers ?? []).some((assigneeId) => Boolean(assigneeId)));

export default function Page() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectOverrides, setProjectOverrides] = useState<Record<string, Partial<Project>>>({});
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [timerTick, setTimerTick] = useState(() => Date.now());
  const [timerBusyId, setTimerBusyId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [pendingTimerStopTask, setPendingTimerStopTask] = useState<Task | null>(null);
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return 10;
    }
    const stored = window.localStorage.getItem(TASK_LIST_PAGE_SIZE_STORAGE_KEY);
    const parsed = Number(stored);
    return TASK_LIST_PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : 10;
  });
  const [visibleListColumns, setVisibleListColumns] = useState<TaskListColumnKey[]>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_VISIBLE_TASK_COLUMNS;
    }
    try {
      const raw = window.localStorage.getItem(TASK_VISIBLE_COLUMNS_STORAGE_KEY);
      if (!raw) {
        return DEFAULT_VISIBLE_TASK_COLUMNS;
      }
      const parsed = JSON.parse(raw) as TaskListColumnKey[];
      const filtered = parsed.filter((key) =>
        TASK_LIST_COLUMNS.some((column) => column.key === key),
      );
      return filtered.length > 0 ? filtered : DEFAULT_VISIBLE_TASK_COLUMNS;
    } catch {
      return DEFAULT_VISIBLE_TASK_COLUMNS;
    }
  });
  const [isCustomizeColumnsOpen, setIsCustomizeColumnsOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [columnDraft, setColumnDraft] = useState<TaskListColumnKey[]>(DEFAULT_VISIBLE_TASK_COLUMNS);
  const [columnSnapshot, setColumnSnapshot] = useState<TaskListColumnKey[]>(
    DEFAULT_VISIBLE_TASK_COLUMNS,
  );

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'task_view']);
  const hasUserVisibility = hasUserVisibilityAccess(user, 'tasks', user?.roleRelations);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'task_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'task_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'task_delete']);
  const canAssign = !!user && hasPermission(user.permissions, ['admin', 'task_assign']);
  const canEditAssignment = canAssign && (!selectedTask || isAdmin);

  const emptyTask = (assignedTo: string): TaskFormState => ({
    title: '',
    description: '',
    assignedTo,
    assignedUsers: assignedTo ? [assignedTo] : [],
    status: 'todo',
    priority: 'medium',
    recurrence: 'none',
    quotationNumber: '',
    startDate: todayKey(),
    endDate: todayKey(),
    dueDate: todayKey(),
    parentTaskId: '',
    projectId: '',
    referenceModelNumber: '',
    estimateNumber: '',
    estimateAmount: '',
    isRevision: false,
    revisionNumber: '',
  });

  const buildTaskFormState = (task: Task): TaskFormState => ({
    title: task.title,
    description: task.description,
    assignedTo: task.assignedTo,
    assignedUsers: task.assignedUsers ?? (task.assignedTo ? [task.assignedTo] : []),
    status: task.status,
    priority: task.priority,
    recurrence: task.recurrence,
    quotationNumber: task.quotationNumber ?? '',
    startDate: task.startDate,
    endDate: task.endDate,
    dueDate: task.dueDate,
    parentTaskId: task.parentTaskId ?? '',
    projectId: task.projectId ?? '',
    referenceModelNumber: task.referenceModelNumber ?? '',
    estimateNumber: task.estimateNumber ?? '',
    estimateAmount:
      typeof task.estimateAmount === 'number' && Number.isFinite(task.estimateAmount)
        ? String(task.estimateAmount)
        : '',
    isRevision: task.isRevision === true,
    revisionNumber: task.revisionNumber ?? '',
  });

  const getTaskDraftStorageKey = useCallback(
    (taskId: string | null) => {
      if (!user) {
        return null;
      }
      return [TASK_MODAL_DRAFT_STORAGE_KEY, user.id, taskId ?? 'new'].join(':');
    },
    [user],
  );

  const readTaskDraft = useCallback(
    (taskId: string | null) => {
      const storageKey = getTaskDraftStorageKey(taskId);
      if (!storageKey || typeof window === 'undefined') {
        return null;
      }
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw) as Partial<TaskFormState>;
      } catch {
        return null;
      }
    },
    [getTaskDraftStorageKey],
  );

  const clearTaskDraft = useCallback(
    (taskId: string | null) => {
      const storageKey = getTaskDraftStorageKey(taskId);
      if (!storageKey || typeof window === 'undefined') {
        return;
      }
      window.localStorage.removeItem(storageKey);
    },
    [getTaskDraftStorageKey],
  );

  const [formState, setFormState] = useState<TaskFormState>(() => emptyTask(''));

  const canEditEstimateDetails =
    !!user && (formState.assignedTo === user.id || formState.assignedUsers.includes(user.id));
  const isFormAssignedTask = useMemo(
    () =>
      isAssignedTask({
        assignedTo: formState.assignedTo,
        assignedUsers: formState.assignedUsers,
      }),
    [formState.assignedTo, formState.assignedUsers],
  );

  const logProjectActivity = async (projectId: string, note: string, type: string = 'task') => {
    if (!user) {
      return;
    }
    await addDoc(
      collection(getFirebaseDb(), 'sales', 'main', 'projects', projectId, 'activities'),
      {
        type,
        note,
        date: new Date().toISOString(),
        createdBy: user.id,
      },
    );
  };

  const logLeadActivity = async (leadId: string, note: string, type: LeadActivityType = 'note') => {
    if (!user) {
      return;
    }
    await firebaseLeadRepository.addActivity(leadId, {
      type,
      note,
      date: new Date().toISOString(),
      createdBy: user.id,
    });
  };

  const syncLinkedQuotationRequestTask = async (
    task: Pick<
      Task,
      | 'quotationRequestId'
      | 'quotationRequestTaskId'
      | 'status'
      | 'estimateNumber'
      | 'estimateAmount'
    >,
    updatedAt: string,
  ) => {
    if (!task.quotationRequestId || !task.quotationRequestTaskId) {
      return;
    }
    const payload: Record<string, unknown> = { updatedAt };
    if (task.status === 'done') {
      payload.status = 'done';
    }
    if (task.estimateNumber?.trim()) {
      payload.estimateNumber = task.estimateNumber.trim();
    }
    if (
      typeof task.estimateAmount === 'number' &&
      Number.isFinite(task.estimateAmount) &&
      task.estimateAmount > 0
    ) {
      payload.estimateAmount = task.estimateAmount;
    }
    await firebaseQuotationRequestRepository.updateTask(
      task.quotationRequestId,
      task.quotationRequestTaskId,
      payload,
    );
  };

  const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '0s';
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${remainder}s`;
    }
    return `${remainder}s`;
  };

  const getLiveDuration = (task: Task) => {
    const base = task.totalTrackedSeconds ?? 0;
    if (!task.timerStartedAt) {
      return base;
    }
    const startedMs = Date.parse(task.timerStartedAt);
    if (Number.isNaN(startedMs)) {
      return base;
    }
    const elapsed = Math.max(0, Math.floor((timerTick - startedMs) / 1000));
    return base + elapsed;
  };

  const canTrackTask = (task: Task) => {
    if (task.status === 'done') {
      return false;
    }
    if (!user || !canEdit) {
      return false;
    }
    if (isAdmin) {
      return true;
    }
    if (task.assignedTo === user.id) {
      return true;
    }
    return (task.assignedUsers ?? []).includes(user.id);
  };

  const visibleUsers = useMemo(
    () => filterUsersByRole(user, users, 'tasks', user?.roleRelations),
    [user, users],
  );

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    visibleUsers.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!hasUserVisibility) {
      return [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [hasUserVisibility, user, visibleUsers]);

  const visibleUserIds = useMemo(() => {
    const ids = new Set<string>(visibleUsers.map((profile) => profile.id));
    if (user) {
      ids.add(user.id);
    }
    return ids;
  }, [visibleUsers, user]);

  const visibleUserScope = useMemo(
    () => Array.from(visibleUserIds).sort().join(','),
    [visibleUserIds],
  );

  const tasksCacheKey = useMemo(() => {
    if (!user) {
      return null;
    }
    const scopeKey = isAdmin
      ? 'admin'
      : hasUserVisibility
        ? `visible:${visibleUserScope}`
        : `self:${user.id}`;
    return ['tasks', user.id, ownerFilter, scopeKey].join(':');
  }, [user, ownerFilter, isAdmin, hasUserVisibility, visibleUserScope]);

  const cachedTasksEntry = tasksCacheKey ? getModuleCacheEntry<Task[]>(tasksCacheKey) : null;
  const [tasks, setTasks] = useState<Task[]>(() => cachedTasksEntry?.data ?? []);
  const [loading, setLoading] = useState(() => !cachedTasksEntry);

  const assignableUsers = useMemo(() => {
    return filterAssignableUsers(users, roles, 'task_assign', {
      currentUser: user,
      moduleKey: 'tasks',
    });
  }, [users, roles, user]);

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const taskProjectMetaMap = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        customerId: string;
        customerName: string;
      }
    >();
    projects.forEach((project) => {
      map.set(project.id, {
        name: project.name,
        customerId: project.customerId,
        customerName: project.customerName,
      });
    });
    Object.entries(projectOverrides).forEach(([id, project]) => {
      const current = map.get(id);
      map.set(id, {
        name: project.name ?? current?.name ?? '',
        customerId: project.customerId ?? current?.customerId ?? '',
        customerName: project.customerName ?? current?.customerName ?? '',
      });
    });
    return map;
  }, [projects, projectOverrides]);

  const getTaskProjectName = useCallback(
    (task: Pick<Task, 'projectId'>) => {
      if (!task.projectId) {
        return '';
      }
      return taskProjectMetaMap.get(task.projectId)?.name ?? task.projectId;
    },
    [taskProjectMetaMap],
  );

  const getTaskCustomerName = useCallback(
    (task: Pick<Task, 'projectId' | 'customerName'>) => {
      if (task.customerName?.trim()) {
        return task.customerName;
      }
      if (!task.projectId) {
        return '';
      }
      return taskProjectMetaMap.get(task.projectId)?.customerName ?? '';
    },
    [taskProjectMetaMap],
  );

  const activityItems = useMemo(() => {
    if (!selectedTask) {
      return [];
    }
    const items: Array<{ label: string; value: string }> = [
      { label: 'Created', value: formatDateTime(selectedTask.createdAt) },
      { label: 'Last updated', value: formatDateTime(selectedTask.updatedAt) },
    ];
    if (selectedTask.timerStartedAt) {
      items.push({
        label: 'Timer started',
        value: formatDateTime(selectedTask.timerStartedAt),
      });
    }
    if (selectedTask.lastTimerStoppedAt) {
      items.push({
        label: 'Timer stopped',
        value: formatDateTime(selectedTask.lastTimerStoppedAt),
      });
    }
    if (selectedTask.totalTrackedSeconds) {
      items.push({
        label: 'Total tracked',
        value: formatDuration(selectedTask.totalTrackedSeconds),
      });
    }
    return items;
  }, [selectedTask]);

  const isSelectedTaskAssignmentLocked = useMemo(
    () => !isAdmin && isAssignedTask(selectedTask),
    [isAdmin, selectedTask],
  );
  const isSelectedTaskStatusWorkflowLocked = useMemo(
    () => !isAdmin && isAssignedTask(selectedTask),
    [isAdmin, selectedTask],
  );
  const getTaskStatusDisplay = (status: TaskStatus) =>
    statusOptions.find((option) => option.value === status)?.label ?? status;

  const syncTasks = useCallback(
    (next: Task[]) => {
      setTasks(next);
      if (tasksCacheKey) {
        setModuleCacheEntry(tasksCacheKey, next);
      }
    },
    [tasksCacheKey],
  );

  const updateTasks = (updater: (current: Task[]) => Task[]) => {
    setTasks((current) => {
      const next = updater(current);
      if (tasksCacheKey) {
        setModuleCacheEntry(tasksCacheKey, next);
      }
      return next;
    });
  };

  const replaceTaskInState = (nextTask: Task) => {
    updateTasks((current) => current.map((item) => (item.id === nextTask.id ? nextTask : item)));
    setSelectedTask((current) => (current?.id === nextTask.id ? nextTask : current));
  };

  const buildVisibleTasks = useCallback(
    (allTasks: Task[]) => {
      const normalized = allTasks.map((task) => ({
        ...task,
        status: normalizeStatus(task.status),
      }));
      if (user?.permissions.includes('admin')) {
        return ownerFilter === 'all'
          ? normalized
          : normalized.filter(
              (task) =>
                task.assignedTo === ownerFilter || (task.assignedUsers ?? []).includes(ownerFilter),
            );
      }

      if (hasUserVisibility) {
        const sameRoleTasks = normalized.filter((task) => {
          if (visibleUserIds.has(task.assignedTo)) {
            return true;
          }
          return (task.assignedUsers ?? []).some((assigneeId) => visibleUserIds.has(assigneeId));
        });
        return ownerFilter === 'all'
          ? sameRoleTasks
          : sameRoleTasks.filter(
              (task) =>
                task.assignedTo === ownerFilter || (task.assignedUsers ?? []).includes(ownerFilter),
            );
      }

      if (!user) {
        return [];
      }

      return normalized.filter((task) => {
        if (task.assignedTo === user.id) {
          return true;
        }
        if ((task.assignedUsers ?? []).includes(user.id)) {
          return true;
        }
        return task.createdBy === user.id;
      });
    },
    [hasUserVisibility, ownerFilter, user, visibleUserIds],
  );

  useEffect(() => {
    const cachedEntry = tasksCacheKey ? getModuleCacheEntry<Task[]>(tasksCacheKey) : null;
    if (!cachedEntry) {
      return;
    }
    setTasks(cachedEntry.data);
    setLoading(false);
  }, [tasksCacheKey]);

  useEffect(() => {
    if (!user || !(hasUserVisibility || canAssign)) {
      setUsers([]);
      setRoles([]);
      return;
    }
    const loadUsers = async () => {
      try {
        const [result, roleSummaries] = await Promise.all([
          firebaseUserRepository.listAll(),
          fetchRoleSummaries(),
        ]);
        setUsers(result);
        setRoles(roleSummaries);
      } catch {
        setUsers([]);
        setRoles([]);
      }
    };
    loadUsers();
  }, [user, hasUserVisibility, canAssign]);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }
    const loadProjects = async () => {
      try {
        const result = isAdmin
          ? await firebaseProjectRepository.listAll()
          : await firebaseProjectRepository.listForUser(user.id, user.role);
        setProjects(result);
      } catch {
        setProjects([]);
      }
    };
    loadProjects();
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!hasUserVisibility) {
      setOwnerFilter('all');
    }
  }, [user, hasUserVisibility]);

  useEffect(() => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      return;
    }
    if (!canView) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const cachedEntry = tasksCacheKey ? getModuleCacheEntry<Task[]>(tasksCacheKey) : null;
    if (cachedEntry) {
      setTasks(cachedEntry.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    const unsubscribe = onSnapshot(
      collection(getFirebaseDb(), 'tasks'),
      (snapshot) => {
        const allTasks = snapshot.docs.map((snap) => ({
          id: snap.id,
          ...(snap.data() as Omit<Task, 'id'>),
        }));
        syncTasks(buildVisibleTasks(allTasks));
        setLoading(false);
      },
      () => {
        setError('Unable to load tasks. Please try again.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user, canView, tasksCacheKey, syncTasks, buildVisibleTasks]);

  useEffect(() => {
    if (!tasks.some((task) => task.timerStartedAt)) {
      return;
    }
    const id = window.setInterval(() => {
      setTimerTick(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [tasks]);

  useEffect(() => {
    const missingProjectIds = Array.from(
      new Set(
        tasks.reduce<string[]>((acc, task) => {
          const { projectId } = task;
          if (!projectId || taskProjectMetaMap.has(projectId)) {
            return acc;
          }
          acc.push(projectId);
          return acc;
        }, []),
      ),
    );
    if (missingProjectIds.length === 0) {
      return;
    }
    let active = true;
    const loadMissingNames = async () => {
      const resolved = await Promise.all(
        missingProjectIds.map(async (projectId) => {
          const snap = await getDoc(doc(getFirebaseDb(), 'sales', 'main', 'projects', projectId));
          if (!snap.exists()) {
            return null;
          }
          const data = snap.data() as {
            name?: unknown;
            customerId?: unknown;
            customerName?: unknown;
          };
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          const customerId = typeof data.customerId === 'string' ? data.customerId.trim() : '';
          const customerName =
            typeof data.customerName === 'string' ? data.customerName.trim() : '';
          if (!name && !customerName) {
            return null;
          }
          return { projectId, name, customerId, customerName } as const;
        }),
      );
      if (!active) {
        return;
      }
      const updates: Record<string, Partial<Project>> = {};
      resolved.forEach((item) => {
        if (item) {
          updates[item.projectId] = {
            name: item.name,
            customerId: item.customerId,
            customerName: item.customerName,
          };
        }
      });
      if (Object.keys(updates).length > 0) {
        setProjectOverrides((prev) => ({ ...prev, ...updates }));
      }
    };
    loadMissingNames();
    return () => {
      active = false;
    };
  }, [tasks, taskProjectMetaMap]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === 'all' ? true : task.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [task.title, task.description, getTaskCustomerName(task), getTaskProjectName(task)].some(
          (value) => value.toLowerCase().includes(term),
        );
      return matchesStatus && matchesSearch;
    });
  }, [tasks, search, statusFilter, getTaskCustomerName, getTaskProjectName]);

  const visibleTaskColumns = useMemo(() => {
    const validKeys = new Set(TASK_LIST_COLUMNS.map((column) => column.key));
    const filtered = visibleListColumns.filter((key) => validKeys.has(key));
    return filtered.length > 0 ? filtered : DEFAULT_VISIBLE_TASK_COLUMNS;
  }, [visibleListColumns]);

  const selectedTaskColumns = useMemo(
    () => TASK_LIST_COLUMNS.filter((column) => visibleTaskColumns.includes(column.key)),
    [visibleTaskColumns],
  );

  const listGridTemplateColumns = useMemo(
    () => selectedTaskColumns.map((column) => `minmax(0, ${column.width})`).join(' '),
    [selectedTaskColumns],
  );

  const listPageCount = Math.max(1, Math.ceil(filteredTasks.length / listPageSize));
  const paginatedTasks = useMemo(() => {
    const start = (listPage - 1) * listPageSize;
    return filteredTasks.slice(start, start + listPageSize);
  }, [filteredTasks, listPage, listPageSize]);
  const listRangeStart = filteredTasks.length === 0 ? 0 : (listPage - 1) * listPageSize + 1;
  const listRangeEnd = Math.min(filteredTasks.length, listPage * listPageSize);

  const filteredColumnOptions = useMemo(() => {
    const term = columnSearch.trim().toLowerCase();
    return TASK_LIST_COLUMNS.filter((column) =>
      term.length === 0 ? true : column.label.toLowerCase().includes(term),
    );
  }, [columnSearch]);

  const pageSizeOptions = useMemo(
    () =>
      TASK_LIST_PAGE_SIZE_OPTIONS.map((size) => ({
        id: String(size),
        name: `${size}`,
      })),
    [],
  );

  const totals = useMemo(() => {
    const todo = tasks.filter((task) => task.status === 'todo').length;
    const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
    const review = tasks.filter((task) => task.status === 'review').length;
    const done = tasks.filter((task) => task.status === 'done').length;
    return { todo, inProgress, review, done };
  }, [tasks]);

  const tasksByStatus = useMemo(
    () => ({
      todo: filteredTasks.filter((task) => task.status === 'todo'),
      'in-progress': filteredTasks.filter((task) => task.status === 'in-progress'),
      review: filteredTasks.filter((task) => task.status === 'review'),
      done: filteredTasks.filter((task) => task.status === 'done'),
    }),
    [filteredTasks],
  );

  const selectedViewIndex = useMemo(
    () =>
      Math.max(
        0,
        taskViewOptions.findIndex((option) => option.value === viewMode),
      ),
    [viewMode],
  );
  const selectedStatusIndex = useMemo(
    () => Math.max(0, taskStatusFilterOptions.indexOf(statusFilter)),
    [statusFilter],
  );

  useEffect(() => {
    if (listPage > listPageCount) {
      setListPage(listPageCount);
    }
  }, [listPage, listPageCount]);

  useEffect(() => {
    setListPage(1);
  }, [search, statusFilter, listPageSize]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(TASK_LIST_PAGE_SIZE_STORAGE_KEY, String(listPageSize));
  }, [listPageSize]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      TASK_VISIBLE_COLUMNS_STORAGE_KEY,
      JSON.stringify(visibleTaskColumns),
    );
  }, [visibleTaskColumns]);

  const openCustomizeColumns = () => {
    setColumnSnapshot(visibleTaskColumns);
    setColumnDraft(visibleTaskColumns);
    setColumnSearch('');
    setIsCustomizeColumnsOpen(true);
  };

  const handleToggleColumnDraft = (key: TaskListColumnKey) => {
    setColumnDraft((current) => {
      if (current.includes(key)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== key);
      }
      const next = TASK_LIST_COLUMNS.map((column) => column.key).filter(
        (columnKey) => current.includes(columnKey) || columnKey === key,
      );
      return next;
    });
  };

  const handleSaveColumnDraft = () => {
    setVisibleListColumns(columnDraft);
    setIsCustomizeColumnsOpen(false);
  };

  const handleCancelColumnDraft = () => {
    setColumnDraft(columnSnapshot);
    setIsCustomizeColumnsOpen(false);
    setColumnSearch('');
  };

  const renderBoardTaskCard = (task: Task, variant: 'list' | 'cards' | 'kanban' = 'list') => {
    const isRunning = !!task.timerStartedAt;
    const totalSeconds = getLiveDuration(task);
    const canTrack = canTrackTask(task);
    const usesTimerWorkflow = isAssignedTask(task);
    const timerLocked = task.status === 'done';
    const canCompleteReviewedTask = usesTimerWorkflow && task.status === 'review' && !isRunning;
    const canResumeTimer =
      !isRunning &&
      !timerLocked &&
      task.status === 'in-progress' &&
      ((task.totalTrackedSeconds ?? 0) > 0 || Boolean(task.lastTimerStoppedAt));
    const timerButtonLabel =
      timerBusyId === task.id
        ? 'Updating...'
        : timerLocked
          ? 'Timer locked'
          : isRunning
            ? 'Stop timer'
            : canResumeTimer
              ? 'Continue'
              : 'Start timer';
    const primaryActionLabel = canCompleteReviewedTask ? 'Mark done' : timerButtonLabel;
    const statusClassName = taskStatusStyles[task.status];
    const showDetails = variant !== 'kanban';
    const assigneeName = task.assignedTo
      ? (ownerNameMap.get(task.assignedTo) ?? task.assignedTo)
      : 'Unassigned';
    const assigneeInitial = assigneeName
      .split(' ')
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    if (variant === 'list') {
      return (
        <div
          key={task.id}
          role="button"
          tabIndex={0}
          onClick={() => handleOpenEdit(task)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleOpenEdit(task);
            }
          }}
          className="grid cursor-pointer gap-3 border-b border-border px-3 py-3 transition hover:bg-[var(--surface-soft)] last:border-b-0 md:items-center md:gap-3 md:px-4"
          style={{ gridTemplateColumns: listGridTemplateColumns }}
        >
          {selectedTaskColumns.map((column) => {
            switch (column.key) {
              case 'assignee':
                return (
                  <div key={column.key} className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[#407056]">
                      {assigneeInitial || 'NA'}
                    </span>
                    <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-text">
                      {assigneeName}
                    </p>
                  </div>
                );
              case 'task':
                return (
                  <p key={column.key} className="truncate text-base font-semibold text-text">
                    {task.title}
                  </p>
                );
              case 'customer':
                return (
                  <p
                    key={column.key}
                    className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted"
                  >
                    {getTaskCustomerName(task) || 'No customer'}
                  </p>
                );
              case 'linked':
                return (
                  <p
                    key={column.key}
                    className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted"
                  >
                    {task.projectId
                      ? getTaskProjectName(task)
                      : task.leadReference || 'No linked record'}
                  </p>
                );
              case 'date':
                return (
                  <p key={column.key} className="text-sm text-text">
                    {formatDate(task.dueDate)}
                  </p>
                );
              case 'status':
                return (
                  <div key={column.key} className="flex flex-col gap-2">
                    {usesTimerWorkflow ? (
                      <span
                        className={`inline-flex rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ${taskBadgeSizeClass} ${statusClassName}`}
                      >
                        {getTaskStatusDisplay(task.status)}
                      </span>
                    ) : (
                      <select
                        value={task.status}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          handleQuickStatusChange(task, event.target.value as TaskStatus)
                        }
                        disabled={!canTrack || statusBusyId === task.id}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] outline-none disabled:cursor-not-allowed disabled:opacity-60 ${taskSelectSizeClass} ${statusClassName}`}
                      >
                        {statusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              case 'priority':
                return (
                  <span
                    key={column.key}
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${taskBadgeSizeClass} ${boardPriorityColor[task.priority]}`}
                  >
                    {task.priority}
                  </span>
                );
              case 'time':
                return (
                  <p key={column.key} className="text-sm text-text">
                    {formatDuration(totalSeconds)}
                  </p>
                );
              case 'action':
                return (
                  <button
                    key={column.key}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (canCompleteReviewedTask) {
                        void handleQuickStatusChange(task, 'done');
                        return;
                      }
                      if (timerLocked) {
                        return;
                      }
                      if (isRunning) {
                        handleStopTaskTimer(task);
                        return;
                      }
                      handleStartTaskTimer(task);
                    }}
                    disabled={
                      timerLocked ||
                      !canTrack ||
                      timerBusyId === task.id ||
                      statusBusyId === task.id
                    }
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60 ${taskBadgeSizeClass} ${
                      canCompleteReviewedTask
                        ? 'border border-[#c08a7a]/45 bg-[rgba(192,138,122,0.14)] text-[#e7b8a7]'
                        : isRunning
                          ? 'border border-[#407056] bg-[#407056] text-white'
                          : timerLocked
                            ? 'border border-border/60 bg-surface text-muted'
                            : 'border border-[#407056]/40 bg-white text-[#407056]'
                    }`}
                  >
                    {canCompleteReviewedTask && statusBusyId === task.id
                      ? 'Updating...'
                      : primaryActionLabel}
                  </button>
                );
            }
          })}
        </div>
      );
    }

    const cardClass =
      variant === 'cards'
        ? 'rounded-3xl border border-border bg-surface p-4 shadow-[0_6px_18px_rgba(15,23,42,0.05)]'
        : 'rounded-3xl border border-border bg-surface p-5 shadow-[0_4px_16px_rgba(15,23,42,0.06)]';

    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        draggable={variant === 'kanban' && !usesTimerWorkflow}
        onDragStart={
          variant === 'kanban'
            ? (event) => {
                event.dataTransfer.effectAllowed = 'move';
                setDraggingTaskId(task.id);
              }
            : undefined
        }
        onDragEnd={
          variant === 'kanban'
            ? () => {
                setDraggingTaskId(null);
                setDragOverStatus(null);
              }
            : undefined
        }
        onClick={() => handleOpenEdit(task)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenEdit(task);
          }
        }}
        className={`${cardClass} cursor-pointer transition hover:-translate-y-[1px]`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
              {task.assignedTo
                ? (ownerNameMap.get(task.assignedTo) ?? task.assignedTo)
                : 'Unassigned'}
            </p>
            <p
              className={`mt-2 font-semibold text-text ${
                variant === 'cards'
                  ? 'text-sm'
                  : variant === 'kanban'
                    ? 'text-2xl'
                    : 'text-2xl sm:text-3xl'
              }`}
            >
              {task.title}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
              boardPriorityColor[task.priority]
            }`}
          >
            {task.priority}
          </span>
        </div>

        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted/80">
          {task.projectId
            ? `Project: ${getTaskProjectName(task)}`
            : task.leadReference
              ? `Lead: ${task.leadReference}`
              : 'No linked record'}
        </div>

        {getTaskCustomerName(task) ? (
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted/80">
            Customer: {getTaskCustomerName(task)}
          </div>
        ) : null}

        {showDetails ? (
          <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <p>Due {formatDate(task.dueDate)}</p>
            <p className="sm:text-right">{formatDuration(totalSeconds)}</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {usesTimerWorkflow ? (
            <span
              className={`inline-flex rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${taskBadgeSizeClass} ${statusClassName}`}
            >
              {getTaskStatusDisplay(task.status)}
            </span>
          ) : (
            <select
              value={task.status}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => handleQuickStatusChange(task, event.target.value as TaskStatus)}
              disabled={!canTrack || statusBusyId === task.id}
              className={`rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] outline-none disabled:cursor-not-allowed disabled:opacity-60 ${taskSelectSizeClass} ${statusClassName}`}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (canCompleteReviewedTask) {
                void handleQuickStatusChange(task, 'done');
                return;
              }
              if (timerLocked) {
                return;
              }
              if (isRunning) {
                handleStopTaskTimer(task);
                return;
              }
              handleStartTaskTimer(task);
            }}
            disabled={
              timerLocked || !canTrack || timerBusyId === task.id || statusBusyId === task.id
            }
            className={`rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-60 ${taskBadgeSizeClass} ${
              canCompleteReviewedTask
                ? 'border border-[#c08a7a]/45 bg-[rgba(192,138,122,0.14)] text-[#e7b8a7]'
                : isRunning
                  ? 'border border-emerald-600 bg-emerald-500 text-white'
                  : timerLocked
                    ? 'border border-border text-muted'
                    : 'border border-emerald-500 text-emerald-700'
            }`}
          >
            {canCompleteReviewedTask && statusBusyId === task.id
              ? 'Updating...'
              : primaryActionLabel}
          </button>
        </div>
      </div>
    );
  };

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedTask(null);
    const baseState = emptyTask('');
    const draft = readTaskDraft(null);
    setFormState(draft ? { ...baseState, ...draft } : baseState);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (task: Task) => {
    setSelectedTask(task);
    const baseState = buildTaskFormState(task);
    const draft = readTaskDraft(task.id);
    setFormState(draft ? { ...baseState, ...draft } : baseState);
    setIsEditOpen(true);
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
  };

  useEffect(() => {
    if ((!isCreateOpen && !isEditOpen) || !user || typeof window === 'undefined') {
      return;
    }
    const storageKey = getTaskDraftStorageKey(selectedTask?.id ?? null);
    if (!storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(formState));
    } catch {
      // Ignore storage write failures and keep the in-memory form usable.
    }
  }, [formState, getTaskDraftStorageKey, isCreateOpen, isEditOpen, selectedTask, user]);

  const selectedProjectForForm = useMemo(
    () => projects.find((project) => project.id === formState.projectId) ?? null,
    [projects, formState.projectId],
  );

  const selectedProjectCustomerName =
    selectedProjectForForm?.customerName ||
    (formState.projectId ? taskProjectMetaMap.get(formState.projectId)?.customerName : '') ||
    (selectedTask?.projectId === formState.projectId ? (selectedTask.customerName ?? '') : '');

  const selectedProjectCustomerId =
    selectedProjectForForm?.customerId ||
    (formState.projectId ? taskProjectMetaMap.get(formState.projectId)?.customerId : '') ||
    (selectedTask?.projectId === formState.projectId ? (selectedTask.customerId ?? '') : '');

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save tasks.');
      return;
    }
    if (!formState.title.trim()) {
      setError('Task title is required.');
      return;
    }
    const isEditing = !!selectedTask;
    const selectedTaskAssignees =
      selectedTask?.assignedUsers ?? (selectedTask?.assignedTo ? [selectedTask.assignedTo] : []);
    const canEditAsParticipant =
      !!selectedTask &&
      !!user &&
      (selectedTask.assignedTo === user.id ||
        selectedTaskAssignees.includes(user.id) ||
        selectedTask.createdBy === user.id);
    if (isEditing && !canEdit && !canEditAsParticipant) {
      setError('You do not have permission to edit tasks.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create tasks.');
      return;
    }
    if (isEditing && !isAdmin && !canEdit && !canEditAsParticipant) {
      setError('You can only edit tasks assigned to you.');
      return;
    }
    if (isEditing && selectedTask && !isAdmin) {
      const previousAssignedUsers = Array.from(new Set(selectedTaskAssignees.filter(Boolean)));
      const nextAssignedUsers = Array.from(new Set(formState.assignedUsers.filter(Boolean)));
      const assignmentChanged =
        selectedTask.assignedTo !== formState.assignedTo ||
        !areSameRecipientSets(previousAssignedUsers, nextAssignedUsers);
      if (assignmentChanged) {
        setError('Only admins can reassign tasks after assignment.');
        return;
      }
    }
    const estimateNumber = formState.estimateNumber.trim();
    const estimateAmountRaw = formState.estimateAmount.trim();
    const estimateAmount = estimateAmountRaw.length > 0 ? Number(estimateAmountRaw) : null;
    const revisionNumber = formState.revisionNumber.trim();
    if (formState.isRevision && !revisionNumber) {
      setError('Revision number is required when marked as revision.');
      return;
    }
    if (!formState.isRevision && revisionNumber.length > 0) {
      setError('Enable "Mark as Revision" to set a revision number.');
      return;
    }
    if (canEditEstimateDetails) {
      if (
        (estimateNumber.length > 0 && estimateAmountRaw.length === 0) ||
        (estimateNumber.length === 0 && estimateAmountRaw.length > 0)
      ) {
        setError('Provide both Estimate No and Estimate Amount.');
        return;
      }
      if (
        estimateAmountRaw.length > 0 &&
        (!Number.isFinite(estimateAmount) || estimateAmount === null || estimateAmount <= 0)
      ) {
        setError('Estimate amount must be greater than 0.');
        return;
      }
    }
    setIsSaving(true);
    setError(null);
    try {
      const syncQuotationRequestStatus = async (quotationRequestId: string) => {
        const request = await firebaseQuotationRequestRepository.getById(quotationRequestId);
        if (!request) {
          return;
        }
        const requestTasks = (await firebaseQuotationRequestRepository.listTasks(
          quotationRequestId,
        )) as Array<{ status?: string }>;
        if (requestTasks.length === 0) {
          return;
        }
        const isReviewReady = requestTasks.every(
          (entry) => String(entry.status ?? '').toLowerCase() === 'done',
        );
        const nextStatus = isReviewReady
          ? request.status === 'completed'
            ? 'completed'
            : 'review'
          : requestTasks.some((entry) => String(entry.status ?? '').toLowerCase() === 'assigned')
            ? 'pending'
            : 'new';
        if (nextStatus !== request.status) {
          await firebaseQuotationRequestRepository.update(quotationRequestId, {
            status: nextStatus,
            updatedAt: new Date().toISOString(),
          });
        }
      };

      const basePayload = {
        title: formState.title.trim(),
        description: formState.description.trim(),
        assignedTo: formState.assignedTo,
        assignedUsers: formState.assignedUsers,
        status:
          isEditing && isSelectedTaskStatusWorkflowLocked && selectedTask
            ? selectedTask.status
            : isFormAssignedTask
              ? 'todo'
              : formState.status,
        priority:
          isEditing && isSelectedTaskAssignmentLocked && selectedTask
            ? selectedTask.priority
            : formState.priority,
        recurrence: formState.recurrence,
        quotationNumber: formState.quotationNumber,
        startDate: formState.startDate,
        endDate:
          (isEditing && isSelectedTaskStatusWorkflowLocked && selectedTask
            ? selectedTask.status
            : isFormAssignedTask
              ? 'todo'
              : formState.status) === 'done'
            ? todayKey()
            : formState.endDate,
        dueDate:
          isEditing && isSelectedTaskAssignmentLocked && selectedTask
            ? selectedTask.dueDate
            : formState.dueDate,
        parentTaskId: formState.parentTaskId,
        projectId: formState.projectId,
        customerId: formState.projectId ? selectedProjectCustomerId : '',
        customerName: formState.projectId ? selectedProjectCustomerName : '',
        referenceModelNumber: formState.referenceModelNumber,
        isRevision: formState.isRevision,
        revisionNumber: formState.isRevision ? revisionNumber : '',
      };
      const estimatePayload =
        canEditEstimateDetails && estimateNumber.length > 0 && estimateAmount !== null
          ? {
              estimateNumber,
              estimateAmount,
            }
          : {};

      if (isEditing && selectedTask) {
        const previousStatus = selectedTask.status;
        const updated = await firebaseTaskRepository.update(selectedTask.id, {
          ...basePayload,
          ...estimatePayload,
          updatedAt: new Date().toISOString(),
        });
        clearTaskDraft(selectedTask.id);
        const updatedAssignedUsers =
          updated.assignedUsers ?? (updated.assignedTo ? [updated.assignedTo] : []);
        const previousAssignedUsers =
          selectedTask.assignedUsers ?? (selectedTask.assignedTo ? [selectedTask.assignedTo] : []);
        const assignmentChanged =
          selectedTask.assignedTo !== updated.assignedTo ||
          !areSameRecipientSets(previousAssignedUsers, updatedAssignedUsers);
        if (assignmentChanged) {
          const recipients = buildAssignedRecipients(
            updated.assignedTo,
            updatedAssignedUsers,
            user.id,
          );
          await emitNotificationEventSafe({
            type: 'task.assigned',
            title: 'New Task Assignment',
            body: `${user.fullName} assigned: ${updated.title}.`,
            actorId: user.id,
            recipients,
            entityType: 'task',
            entityId: updated.id,
            requiredPermissionsAnyOf: getTaskNotificationPermissions(updated),
            meta: {
              assignedTo: updated.assignedTo,
            },
          });
        }
        if (previousStatus !== updated.status) {
          const recipients = buildRecipientList(
            updated.createdBy,
            [updated.assignedTo, ...updatedAssignedUsers],
            user.id,
          );
          const statusLabel = updated.status.replace('-', ' ');
          await emitNotificationEventSafe({
            type: 'task.status_changed',
            title: 'Task Status Updated',
            body: `${user.fullName} changed ${updated.title} to ${statusLabel}.`,
            actorId: user.id,
            recipients,
            entityType: 'task',
            entityId: updated.id,
            requiredPermissionsAnyOf: getTaskNotificationPermissions(updated),
            meta: {
              status: updated.status,
            },
          });
        }
        if (updated.projectId) {
          const changes: string[] = [];
          if (selectedTask.title !== updated.title) {
            changes.push(`Title updated to ${updated.title}.`);
          }
          if (selectedTask.status !== updated.status) {
            const statusLabel = updated.status.replace('-', ' ');
            changes.push(`Status updated to ${statusLabel}.`);
            if (updated.status === 'done') {
              changes.push('Task completed.');
            }
          }
          if (selectedTask.priority !== updated.priority) {
            changes.push(`Priority updated to ${updated.priority}.`);
          }
          if ((selectedTask.dueDate ?? '') !== (updated.dueDate ?? '')) {
            changes.push(
              `Due date updated to ${updated.dueDate ? formatDate(updated.dueDate) : 'None'}.`,
            );
          }
          if ((selectedTask.referenceModelNumber ?? '') !== (updated.referenceModelNumber ?? '')) {
            changes.push(
              `Reference Model Number updated to ${updated.referenceModelNumber || 'None'}.`,
            );
          }
          if (changes.length > 0) {
            await logProjectActivity(
              updated.projectId,
              `Task updated: ${updated.title}. ${changes.join(' ')}`,
            );
          }
        }
        if (updated.quotationRequestId && updated.quotationRequestTaskId) {
          const completedAt = new Date().toISOString();
          await syncLinkedQuotationRequestTask(updated, completedAt);
          if (previousStatus !== 'done' && updated.status === 'done') {
            await syncQuotationRequestStatus(updated.quotationRequestId);
          }
          if (
            previousStatus !== 'done' &&
            updated.status === 'done' &&
            updated.leadId &&
            updated.rfqTag
          ) {
            await firebaseLeadRepository.addActivity(updated.leadId, {
              type: 'note',
              note: `RFQ task completed: ${updated.rfqTag}.`,
              date: completedAt,
              createdBy: user.id,
            });
          }
        }
        updateTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      } else {
        const created = await firebaseTaskRepository.create({
          ...basePayload,
          ...estimatePayload,
          sharedRoles: [],
          createdBy: user.id,
        });
        clearTaskDraft(null);
        updateTasks((prev) => [created, ...prev]);
        const recipients = buildAssignedRecipients(
          created.assignedTo,
          created.assignedUsers ?? [],
          user.id,
        );
        await emitNotificationEventSafe({
          type: 'task.assigned',
          title: 'New Task',
          body: `${user.fullName} assigned: ${created.title}.`,
          actorId: user.id,
          recipients,
          entityType: 'task',
          entityId: created.id,
          requiredPermissionsAnyOf: getTaskNotificationPermissions(created),
        });
        if (created.projectId) {
          await logProjectActivity(created.projectId, `Task created: ${created.title}.`);
        }
      }
      handleCloseModal();
    } catch {
      setError('Unable to save task. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartTaskTimer = async (task: Task) => {
    if (!user) {
      setError('You must be signed in to start timers.');
      return;
    }
    if (!canTrackTask(task)) {
      setError('You do not have permission to start this timer.');
      return;
    }
    if (task.status === 'done') {
      setError('Completed tasks cannot restart the timer.');
      return;
    }
    if (task.timerStartedAt) {
      return;
    }
    setTimerBusyId(task.id);
    setError(null);
    const previousTask = task;
    try {
      const startedAt = new Date().toISOString();
      const startedDate = todayKey();
      const nextStatus = isAssignedTask(task)
        ? 'in-progress'
        : task.status === 'todo'
          ? 'in-progress'
          : task.status;
      const optimisticTask: Task = {
        ...task,
        timerStartedAt: startedAt,
        startDate: startedDate,
        status: nextStatus,
        updatedAt: startedAt,
      };
      replaceTaskInState(optimisticTask);
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: startedAt,
        startDate: startedDate,
        status: nextStatus,
        updatedAt: startedAt,
      });
      replaceTaskInState(updated);
      const recipients = buildRecipientList(
        updated.createdBy,
        [updated.assignedTo, ...(updated.assignedUsers ?? [])],
        user.id,
      );
      void emitNotificationEventSafe({
        type: 'task.timer_started',
        title: 'Task Timer Started',
        body: `${user.fullName} started the timer for ${updated.title}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        requiredPermissionsAnyOf: getTaskNotificationPermissions(updated),
        meta: {
          timerStartedAt: startedAt,
        },
      });
      if (task.projectId) {
        void logProjectActivity(task.projectId, `Task started: ${task.title}.`);
      }
      if (task.leadId) {
        void logLeadActivity(task.leadId, `Task started: ${task.title}.`);
      }
    } catch {
      replaceTaskInState(previousTask);
      setError('Unable to start timer. Please try again.');
    } finally {
      setTimerBusyId(null);
    }
  };

  const handleStopTaskTimer = async (task: Task) => {
    if (!user) {
      setError('You must be signed in to stop timers.');
      return;
    }
    if (!canTrackTask(task)) {
      setError('You do not have permission to stop this timer.');
      return;
    }
    if (!task.timerStartedAt) {
      return;
    }
    setPendingTimerStopTask(task);
  };

  const handleFinalizeTaskTimerStop = async (task: Task, nextStep: 'break' | 'review') => {
    if (!user) {
      setError('You must be signed in to stop timers.');
      return;
    }
    if (!canTrackTask(task)) {
      setError('You do not have permission to stop this timer.');
      return;
    }
    if (!task.timerStartedAt) {
      return;
    }
    const startedMs = Date.parse(task.timerStartedAt);
    if (Number.isNaN(startedMs)) {
      setError('Unable to read the timer start time.');
      return;
    }
    setTimerBusyId(task.id);
    setError(null);
    const previousTask = task;
    try {
      const stoppedAt = new Date().toISOString();
      const stoppedDate = todayKey();
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      const totalSeconds = (task.totalTrackedSeconds ?? 0) + durationSeconds;
      const nextStatus = nextStep === 'review' ? 'review' : 'in-progress';
      const optimisticTask: Task = {
        ...task,
        timerStartedAt: '',
        lastTimerStoppedAt: stoppedAt,
        lastTimerDurationSeconds: durationSeconds,
        totalTrackedSeconds: totalSeconds,
        endDate: stoppedDate,
        status: nextStatus,
        updatedAt: stoppedAt,
      };
      replaceTaskInState(optimisticTask);
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: '',
        lastTimerStoppedAt: stoppedAt,
        lastTimerDurationSeconds: durationSeconds,
        totalTrackedSeconds: totalSeconds,
        endDate: stoppedDate,
        status: nextStatus,
        updatedAt: stoppedAt,
      });
      replaceTaskInState(updated);
      const recipients = buildRecipientList(
        updated.createdBy,
        [updated.assignedTo, ...(updated.assignedUsers ?? [])],
        user.id,
      );
      void emitNotificationEventSafe({
        type: 'task.timer_stopped',
        title: nextStep === 'review' ? 'Task Sent To Review' : 'Task Timer Stopped',
        body:
          nextStep === 'review'
            ? `${user.fullName} stopped the timer for ${updated.title} and moved it to review.`
            : `${user.fullName} stopped the timer for ${updated.title}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        requiredPermissionsAnyOf: getTaskNotificationPermissions(updated),
        meta: {
          durationSeconds,
          totalSeconds,
          status: updated.status,
        },
      });
      const note =
        nextStep === 'review'
          ? `Task moved to review: ${task.title}. Duration ${formatDuration(durationSeconds)}. Total ${formatDuration(totalSeconds)}.`
          : `Task paused for break: ${task.title}. Duration ${formatDuration(durationSeconds)}. Total ${formatDuration(totalSeconds)}.`;
      if (task.projectId) {
        void logProjectActivity(task.projectId, note);
      }
      if (task.leadId) {
        void logLeadActivity(task.leadId, note);
      }
    } catch {
      replaceTaskInState(previousTask);
      setError('Unable to stop timer. Please try again.');
    } finally {
      setPendingTimerStopTask(null);
      setTimerBusyId(null);
    }
  };

  const handleQuickStatusChange = async (task: Task, nextStatus: TaskStatus) => {
    if (!user) {
      setError('You must be signed in to update task status.');
      return;
    }
    if (!canTrackTask(task)) {
      setError('You do not have permission to update this task status.');
      return;
    }
    if (!isAdmin && isAssignedTask(task)) {
      if (nextStatus === 'done' && task.status === 'review') {
        // Allow completion after review through the dedicated action.
      } else {
        setError('Assigned task status is controlled by timer actions and review completion.');
        return;
      }
    }
    if (nextStatus === task.status) {
      return;
    }
    if (!isAdmin && nextStatus === 'done' && task.status !== 'review') {
      setError('A task must be moved to review before it can be marked as done.');
      return;
    }
    setStatusBusyId(task.id);
    setError(null);
    try {
      const syncQuotationRequestStatus = async (quotationRequestId: string) => {
        const request = await firebaseQuotationRequestRepository.getById(quotationRequestId);
        if (!request) {
          return;
        }
        const requestTasks = (await firebaseQuotationRequestRepository.listTasks(
          quotationRequestId,
        )) as Array<{ status?: string }>;
        if (requestTasks.length === 0) {
          return;
        }
        const isReviewReady = requestTasks.every(
          (entry) => String(entry.status ?? '').toLowerCase() === 'done',
        );
        const nextStatus = isReviewReady
          ? request.status === 'completed'
            ? 'completed'
            : 'review'
          : requestTasks.some((entry) => String(entry.status ?? '').toLowerCase() === 'assigned')
            ? 'pending'
            : 'new';
        if (nextStatus !== request.status) {
          await firebaseQuotationRequestRepository.update(quotationRequestId, {
            status: nextStatus,
            updatedAt: new Date().toISOString(),
          });
        }
      };

      const updatedAt = new Date().toISOString();
      const updated = await firebaseTaskRepository.update(task.id, {
        status: nextStatus,
        endDate: nextStatus === 'done' ? todayKey() : task.endDate,
        updatedAt,
      });
      updateTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      const recipients = buildRecipientList(
        updated.createdBy,
        [updated.assignedTo, ...(updated.assignedUsers ?? [])],
        user.id,
      );
      const statusLabel = updated.status.replace('-', ' ');
      await emitNotificationEventSafe({
        type: 'task.status_changed',
        title: 'Task Status Updated',
        body: `${user.fullName} changed ${updated.title} to ${statusLabel}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        requiredPermissionsAnyOf: getTaskNotificationPermissions(updated),
        meta: {
          status: updated.status,
        },
      });
      if (updated.projectId) {
        await logProjectActivity(
          updated.projectId,
          `Task updated: ${updated.title}. Status updated to ${statusLabel}.${updated.status === 'done' ? ' Task completed.' : ''}`,
        );
      }
      if (
        task.status !== 'done' &&
        updated.status === 'done' &&
        updated.quotationRequestId &&
        updated.quotationRequestTaskId
      ) {
        await syncLinkedQuotationRequestTask(updated, updatedAt);
        await syncQuotationRequestStatus(updated.quotationRequestId);
        if (updated.leadId && updated.rfqTag) {
          await firebaseLeadRepository.addActivity(updated.leadId, {
            type: 'note',
            note: `RFQ task completed: ${updated.rfqTag}.`,
            date: updatedAt,
            createdBy: user.id,
          });
        }
      }
    } catch {
      setError('Unable to update task status. Please try again.');
    } finally {
      setStatusBusyId(null);
    }
  };

  const handleDropTaskToStatus = async (status: TaskStatus) => {
    if (!draggingTaskId) {
      return;
    }
    const task = tasks.find((item) => item.id === draggingTaskId);
    setDraggingTaskId(null);
    setDragOverStatus(null);
    if (!task || task.status === status) {
      return;
    }
    if (!isAdmin && isAssignedTask(task)) {
      setError('Assigned task status is controlled by timer actions and review completion.');
      return;
    }
    await handleQuickStatusChange(task, status);
  };

  const handleDelete = async () => {
    if (!selectedTask) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete tasks.');
      return;
    }
    if (!canDelete) {
      setError('You do not have permission to delete tasks.');
      return;
    }
    if (!isAdmin && selectedTask.assignedTo !== user.id) {
      setError('You can only delete tasks assigned to you.');
      return;
    }
    const confirmed = window.confirm('Delete this task? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseTaskRepository.delete(selectedTask.id);
      clearTaskDraft(selectedTask.id);
      updateTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete task. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">Tasks</p>
            <h1 className="mt-2 font-display text-5xl text-text">Team task board</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Track tasks across modules with role-based shared visibility and due-date focus.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {hasUserVisibility ? (
              <FilterDropdown
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={ownerOptions}
                ariaLabel="Task owner filter"
              />
            ) : null}
            <div className="relative grid grid-cols-3 rounded-2xl border border-border bg-surface p-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-text shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out"
                style={{
                  width: 'calc((100% - 1rem) / 3)',
                  transform: `translateX(calc(${selectedViewIndex} * 100%))`,
                }}
              />
              {taskViewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setViewMode(option.value)}
                  className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                    viewMode === option.value ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="rounded-2xl border border-emerald-500 bg-emerald-500 px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(16,185,129,0.22)] transition hover:-translate-y-[1px] hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              + New task
            </button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">To do</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.todo}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              In progress
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.inProgress}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Review
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.review}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Completed
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.done}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-border bg-surface p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
          <div className="flex flex-col gap-3 xl:min-w-0 xl:flex-1 lg:flex-row lg:flex-wrap lg:items-center xl:flex-nowrap">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs text-muted sm:w-auto sm:min-w-[250px]">
              <input
                type="search"
                placeholder="Search tasks..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/80"
              />
            </div>
            <div className="w-full md:hidden">
              <div className="relative w-full rounded-lg border border-border bg-[var(--surface-muted)] p-1">
                <div className="relative z-[1] grid grid-cols-2 gap-1">
                  {taskStatusFilterOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`rounded-md px-2 py-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.08em] transition ${
                        statusFilter === status
                          ? 'bg-emerald-500 text-white shadow-[0_8px_16px_rgba(16,185,129,0.25)]'
                          : 'text-muted hover:text-text'
                      }`}
                    >
                      {status === 'all'
                        ? 'All'
                        : status.replace('-', ' ').replace(/\b\w/g, (value) => value.toUpperCase())}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative hidden rounded-2xl border border-border bg-[var(--surface-muted)] p-1 lg:block lg:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${taskStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${taskStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {taskStatusFilterOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                      statusFilter === status ? 'text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {status === 'all'
                      ? 'All'
                      : status.replace('-', ' ').replace(/\b\w/g, (value) => value.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:ml-auto xl:flex-nowrap xl:justify-end">
            {viewMode === 'list' ? (
              <>
                <button
                  type="button"
                  onClick={openCustomizeColumns}
                  aria-label="Customize columns"
                  title="Customize columns"
                  className="rounded-2xl border border-border bg-[var(--surface-soft)] px-3 py-2 text-text transition hover:bg-hover/80"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                    <circle cx="9" cy="6" r="2" />
                    <circle cx="15" cy="12" r="2" />
                    <circle cx="11" cy="18" r="2" />
                  </svg>
                </button>
                <FilterDropdown
                  value={String(listPageSize)}
                  onChange={(value) => setListPageSize(Number(value))}
                  options={pageSizeOptions}
                  ariaLabel="Tasks per page"
                  prefixLabel="Per page"
                  buttonClassName="min-w-[136px] gap-2 bg-[var(--surface-soft)] px-3 py-2 text-[11px] shadow-none"
                />
                <div className="flex items-center overflow-hidden rounded-2xl border border-border bg-[var(--surface-soft)]">
                  <button
                    type="button"
                    onClick={() => setListPage((current) => Math.max(1, current - 1))}
                    disabled={listPage === 1}
                    className="px-2.5 py-2 text-sm text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <span className="border-x border-border px-2.5 py-2 text-sm text-muted">
                    {listRangeStart}-{listRangeEnd}
                  </span>
                  <button
                    type="button"
                    onClick={() => setListPage((current) => Math.min(listPageCount, current + 1))}
                    disabled={listPage === listPageCount}
                    className="px-2.5 py-2 text-sm text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </>
            ) : null}
            <p className="whitespace-nowrap text-[11px] text-muted/70">
              {filteredTasks.length} tasks visible
            </p>
          </div>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-3xl border border-border bg-surface p-6 text-sm text-muted">
            You do not have permission to view tasks.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-3xl border border-border bg-surface p-6 text-sm text-muted">
            Loading tasks...
          </div>
        ) : (
          <div key={viewMode} className="animate-fade-up">
            {viewMode === 'list' ? (
              <div className="mt-6">
                <div
                  className="mb-3 hidden rounded-3xl border border-border bg-[var(--surface-soft)] px-4 py-3 md:grid md:items-center md:gap-3"
                  style={{ gridTemplateColumns: listGridTemplateColumns }}
                >
                  {selectedTaskColumns.map((column) => (
                    <p
                      key={column.key}
                      className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-muted"
                    >
                      {column.label}
                    </p>
                  ))}
                </div>

                <div className="overflow-hidden rounded-3xl border border-border bg-surface">
                  {paginatedTasks.map((task) => renderBoardTaskCard(task, 'list'))}
                  {paginatedTasks.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted">
                      No tasks match the current filters.
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-col gap-3 rounded-3xl border border-border bg-[var(--surface-soft)] px-4 py-4 text-sm text-muted md:flex-row md:items-center md:justify-between">
                  <p>
                    Showing {listRangeStart}-{listRangeEnd} of {filteredTasks.length} tasks
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setListPage((current) => Math.max(1, current - 1))}
                      disabled={listPage === 1}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                      Page {listPage} / {listPageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setListPage((current) => Math.min(listPageCount, current + 1))}
                      disabled={listPage === listPageCount}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : viewMode === 'cards' ? (
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredTasks.map((task) => renderBoardTaskCard(task, 'cards'))}
                {canCreate ? (
                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="rounded-3xl border-2 border-dashed border-border/70 bg-[var(--surface-soft)] p-6 text-center"
                  >
                    <p className="text-lg font-semibold text-text">Add New Task</p>
                    <p className="mt-2 text-sm text-muted/80">
                      Click to create a new task in this view
                    </p>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-6 grid gap-4 xl:grid-cols-4">
                {(
                  [
                    { key: 'todo', label: 'To Do' },
                    { key: 'in-progress', label: 'In Progress' },
                    { key: 'review', label: 'Review' },
                    { key: 'done', label: 'Completed' },
                  ] as const
                ).map((column) => (
                  <div
                    key={column.key}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (dragOverStatus !== column.key) {
                        setDragOverStatus(column.key);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverStatus === column.key) {
                        setDragOverStatus(null);
                      }
                    }}
                    onDrop={async (event) => {
                      event.preventDefault();
                      await handleDropTaskToStatus(column.key);
                    }}
                    className={`rounded-3xl border bg-surface p-3 transition ${
                      dragOverStatus === column.key
                        ? 'border-emerald-400 ring-2 ring-emerald-300/50'
                        : 'border-border'
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between px-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
                        {column.label}
                      </p>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-muted">
                        {tasksByStatus[column.key].length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {tasksByStatus[column.key].length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-border/70 bg-surface p-8 text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted/80">
                          No tasks
                        </div>
                      ) : (
                        tasksByStatus[column.key].map((task) => renderBoardTaskCard(task, 'kanban'))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {isCustomizeColumnsOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCancelColumnDraft}
        >
          <DraggablePanel
            className="w-full max-w-xl rounded-3xl border border-border/60 bg-surface/95 p-5 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Customize Columns
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Task list columns</h3>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  {columnDraft.length} of {TASK_LIST_COLUMNS.length} selected
                </p>
                <button
                  type="button"
                  onClick={handleCancelColumnDraft}
                  className="mt-2 rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted transition hover:bg-hover/80"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-5">
              <input
                type="search"
                value={columnSearch}
                onChange={(event) => setColumnSearch(event.target.value)}
                placeholder="Search columns..."
                className="w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none placeholder:text-muted/80"
              />
            </div>

            <div className="mt-5 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {filteredColumnOptions.map((column) => {
                const checked = columnDraft.includes(column.key);
                return (
                  <label
                    key={column.key}
                    className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text"
                  >
                    <span className="font-medium">{column.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleColumnDraft(column.key)}
                      disabled={checked && columnDraft.length === 1}
                      className="h-4 w-4"
                    />
                  </label>
                );
              })}
              {filteredColumnOptions.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-6 text-center text-sm text-muted">
                  No columns match your search.
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelColumnDraft}
                className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm font-semibold text-text transition hover:bg-hover/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveColumnDraft}
                className="rounded-2xl border border-emerald-500 bg-emerald-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                Save
              </button>
            </div>
          </DraggablePanel>
        </div>
      ) : null}

      {(isCreateOpen || isEditOpen) && (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseModal}
        >
          <DraggablePanel
            className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border border-border/60 bg-surface/95 p-4 shadow-floating sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  {selectedTask ? 'Edit task' : 'Create task'}
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Task details</h3>
                <p className="mt-2 text-sm text-muted">
                  Assign tasks, set dates, and control shared access.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid min-h-0 gap-4 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[1.2fr_0.8fr] md:grid-rows-none md:gap-6">
              <form
                className="min-h-0 grid grid-cols-2 gap-4 overflow-y-auto pr-1"
                onSubmit={handleSave}
              >
                <div className="col-span-2 grid gap-4 grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Title
                    </label>
                    <input
                      required
                      value={formState.title}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, title: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      placeholder="Follow up with Atlas Corp"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Assigned to
                    </label>
                    <select
                      value={formState.assignedTo}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          assignedTo: event.target.value,
                          assignedUsers: event.target.value ? [event.target.value] : [],
                        }))
                      }
                      disabled={!canEditAssignment}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    >
                      {!canEditAssignment ? (
                        <option value={formState.assignedTo}>
                          {formState.assignedTo
                            ? (ownerNameMap.get(formState.assignedTo) ?? formState.assignedTo)
                            : 'Unassigned'}
                        </option>
                      ) : assignableUsers.length === 0 ? (
                        <option value="">Unassigned</option>
                      ) : (
                        <>
                          <option value="">Unassigned</option>
                          {assignableUsers.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.fullName}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Description
                  </label>
                  <textarea
                    value={formState.description}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, description: event.target.value }))
                    }
                    className="mt-2 min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>

                <div className="col-span-2 grid gap-4 grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Status
                    </label>
                    <select
                      value={formState.status}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          status: event.target.value as TaskStatus,
                        }))
                      }
                      disabled={isFormAssignedTask || isSelectedTaskStatusWorkflowLocked}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {isFormAssignedTask || isSelectedTaskStatusWorkflowLocked ? (
                      <p className="mt-2 text-xs text-muted">
                        Assigned tasks move through status via timer actions only.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Priority
                    </label>
                    <select
                      value={formState.priority}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          priority: event.target.value as TaskPriority,
                        }))
                      }
                      disabled={isSelectedTaskAssignmentLocked}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    >
                      {priorityOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {canEditEstimateDetails ? (
                  <div className="col-span-2 grid gap-4 grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Estimate No
                      </label>
                      <input
                        value={formState.estimateNumber}
                        onChange={(event) =>
                          setFormState((prev) => ({ ...prev, estimateNumber: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                        placeholder="EST-2026-001"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Estimate Amount
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={formState.estimateAmount}
                        onChange={(event) =>
                          setFormState((prev) => ({ ...prev, estimateAmount: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                        placeholder="10000"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="col-span-2 grid gap-4 grid-cols-2">
                  <div className="col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Due date
                    </label>
                    <input
                      type="date"
                      value={formState.dueDate}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, dueDate: event.target.value }))
                      }
                      disabled={isSelectedTaskAssignmentLocked}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    />
                  </div>
                  <div>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      <input
                        type="checkbox"
                        checked={formState.isRevision}
                        onChange={(event) =>
                          setFormState((prev) => ({
                            ...prev,
                            isRevision: event.target.checked,
                            revisionNumber: event.target.checked ? prev.revisionNumber : '',
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Mark as Revision
                    </label>
                    {formState.isRevision ? (
                      <div className="mt-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                          Revision Number
                        </label>
                        <input
                          value={formState.revisionNumber}
                          onChange={(event) =>
                            setFormState((prev) => ({
                              ...prev,
                              revisionNumber: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                          placeholder="REV-01"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="col-span-2 grid gap-4 grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Parent task (optional)
                    </label>
                    <input
                      value={formState.parentTaskId}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, parentTaskId: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Link to project (optional)
                    </label>
                    <select
                      value={formState.projectId}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, projectId: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    >
                      <option value="">Select project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Customer
                  </label>
                  <input
                    value={selectedProjectCustomerName}
                    readOnly
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/50 px-4 py-2 text-sm text-text outline-none"
                    placeholder={
                      formState.projectId
                        ? 'Customer will be pulled from the selected project'
                        : 'Select a project to inherit the customer'
                    }
                  />
                </div>

                <div className="col-span-2 flex flex-wrap items-center justify-end gap-3">
                  {selectedTask && canDelete ? (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? 'Saving...' : selectedTask ? 'Save changes' : 'Create task'}
                  </button>
                </div>
              </form>

              <div className="min-h-0 overflow-y-auto rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Activity log
                </p>
                <p className="mt-2 text-sm text-muted">Key task events and updates.</p>
                <div className="mt-4 space-y-3">
                  {activityItems.length === 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-bg/80 p-3 text-sm text-muted">
                      No activity yet.
                    </div>
                  ) : (
                    activityItems.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-border/60 bg-bg/80 p-3"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                          {item.label}
                        </p>
                        <p className="mt-2 text-sm text-text">{item.value}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </DraggablePanel>
        </div>
      )}

      {pendingTimerStopTask ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => setPendingTimerStopTask(null)}
        >
          <DraggablePanel
            className="w-full max-w-lg rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Stop timer
            </p>
            <h3 className="mt-2 font-display text-2xl text-text">Choose the next step</h3>
            <p className="mt-3 text-sm text-muted">
              Stopping the timer records the current time. You can either pause work or move the
              task to review.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleFinalizeTaskTimerStop(pendingTimerStopTask, 'break')}
                disabled={timerBusyId === pendingTimerStopTask.id}
                className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-left text-sm text-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold uppercase tracking-[0.18em] text-text">
                  Take a Break
                </span>
                <span className="mt-1 block text-muted">
                  Stop the timer and keep the task in its current working state.
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleFinalizeTaskTimerStop(pendingTimerStopTask, 'review')}
                disabled={timerBusyId === pendingTimerStopTask.id}
                className="rounded-2xl border border-emerald-500/40 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block font-semibold uppercase tracking-[0.18em]">
                  Proceed to Review
                </span>
                <span className="mt-1 block text-emerald-800/80">
                  Stop the timer and move the task into review.
                </span>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setPendingTimerStopTask(null)}
                disabled={timerBusyId === pendingTimerStopTask.id}
                className="rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}
