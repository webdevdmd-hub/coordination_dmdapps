'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { firebaseCustomerRepository } from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { FilterDropdown } from '@/components/ui/FilterDropdown';
import { Customer } from '@/core/entities/customer';
import { Project, ProjectStatus } from '@/core/entities/project';
import { Task, TaskPriority, TaskStatus } from '@/core/entities/task';
import { User } from '@/core/entities/user';
import { getFirebaseAuth, getFirebaseDb } from '@/frameworks/firebase/client';
import {
  getModuleCacheEntry,
  isModuleCacheFresh,
  MODULE_CACHE_TTL_MS,
  setModuleCacheEntry,
} from '@/lib/moduleDataCache';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import { filterUsersByRole, hasUserVisibilityAccess } from '@/lib/roleVisibility';
import {
  areSameRecipientSets,
  buildRecipientList,
  emitNotificationEventSafe,
  getModuleNotificationPermissions,
} from '@/lib/notifications';

const statusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'not-started', label: 'Not Started' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'on-hold', label: 'Hold On' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
];

const statusStyles: Record<ProjectStatus, string> = {
  'not-started': 'bg-surface-strong text-text',
  'in-progress': 'bg-[#00B67A]/16 text-[#00B67A]',
  'on-hold': 'bg-amber-500/20 text-amber-200',
  completed: 'bg-[#00B67A]/22 text-[#00B67A]',
  canceled: 'bg-rose-500/20 text-rose-200',
};

const taskStatusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

const taskPriorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const taskStatusPill: Record<TaskStatus, string> = {
  todo: 'bg-surface-strong/80 text-text',
  'in-progress': 'bg-accent/70 text-text',
  review: 'bg-indigo-500/20 text-indigo-200',
  done: 'bg-emerald-200 text-emerald-900',
};

const taskPriorityPill: Record<TaskPriority, string> = {
  low: 'bg-emerald-500/20 text-emerald-200',
  medium: 'bg-amber-500/20 text-amber-200',
  high: 'bg-rose-500/20 text-rose-200',
  urgent: 'bg-rose-500 text-white',
};

const isEstimateProjectTask = (task?: Pick<Task, 'isEstimateTemplateTask' | 'title'> | null) =>
  !!task &&
  (task.isEstimateTemplateTask === true || task.title.trim().toLowerCase() === 'estimate');

const buildAssignedRecipients = (assignedUsers: string[] | undefined, actorId: string) =>
  buildRecipientList('', assignedUsers ?? [], actorId);

const isAssignedTask = (task?: Pick<Task, 'assignedTo' | 'assignedUsers'> | null) =>
  !!task &&
  (Boolean(task.assignedTo?.trim()) ||
    (task.assignedUsers ?? []).some((assigneeId) => Boolean(assigneeId)));

type ProjectFormState = {
  name: string;
  customerId: string;
  customerName: string;
  assignedTo: string;
  startDate: string;
  dueDate: string;
  value: string;
  status: ProjectStatus;
  description: string;
  sharedRoles: string[];
};

type ProjectTaskFormState = {
  title: string;
  description: string;
  assignedUsers: string[];
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  referenceModelNumber: string;
  estimateNumber: string;
  estimateAmount: string;
  isRevision: boolean;
  revisionNumber: string;
};

type SalesOrderRequestFormState = {
  estimateNumber: string;
  estimateAmount: string;
  salesOrderNumber: string;
  salesOrderAmount: string;
  salesOrderDate: string;
};

type ProjectActivity = {
  id: string;
  note: string;
  date: string;
  createdBy: string;
  type?: string;
};

const TIMELINE_PAGE_SIZE = 12;
const PROJECT_MODAL_DRAFT_STORAGE_KEY = 'projects-modal-draft';
const PROJECT_TASK_MODAL_DRAFT_STORAGE_KEY = 'projects-task-modal-draft';
const PROJECT_SALES_ORDER_MODAL_DRAFT_STORAGE_KEY = 'projects-sales-order-modal-draft';

const todayKey = () => new Date().toISOString().slice(0, 10);
const emptySalesOrderForm = (): SalesOrderRequestFormState => ({
  estimateNumber: '',
  estimateAmount: '',
  salesOrderNumber: '',
  salesOrderAmount: '',
  salesOrderDate: todayKey(),
});

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

const formatTimelineDate = (value?: string) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const taskTemplates = [
  { title: 'Estimate', description: 'Prepare project estimate.' },
  { title: 'Lux Calculation', description: 'Complete lux level calculation.' },
  { title: 'Lighting Layout', description: 'Draft lighting layout.' },
  { title: 'Technical Data Sheet', description: 'Compile technical data sheet.' },
  { title: 'Material Submittal', description: 'Prepare material submittal.' },
  { title: 'Compliance Sheet', description: 'Complete compliance sheet.' },
  { title: 'Catalog', description: 'Assemble catalog package.' },
];

const formatStatusLabel = (value: string) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const activityDotClass = (activity: ProjectActivity) => {
  const note = activity.note.toLowerCase();
  if (activity.type === 'quotation_status') {
    return 'bg-cyan-500';
  }
  if (activity.type === 'quotation_finalized') {
    return 'bg-emerald-500';
  }
  if (activity.type === 'quotation_deadline') {
    return 'bg-amber-500';
  }
  if (note.includes('rfq')) {
    return 'bg-emerald-500';
  }
  if (note.includes('convert')) {
    return 'bg-indigo-500';
  }
  if (note.includes('task')) {
    return 'bg-amber-500';
  }
  if (note.includes('updated')) {
    return 'bg-orange-500';
  }
  if (activity.type === 'meeting') {
    return 'bg-purple-500';
  }
  if (activity.type === 'email') {
    return 'bg-sky-500';
  }
  if (activity.type === 'call') {
    return 'bg-rose-500';
  }
  if (activity.type === 'note') {
    return 'bg-slate-400';
  }
  return 'bg-blue-500';
};

export default function Page() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isTaskSaving, setIsTaskSaving] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [projectDetailsView, setProjectDetailsView] = useState<'general' | 'tasks'>('general');
  const [timelineBaseItems, setTimelineBaseItems] = useState<ProjectActivity[]>([]);
  const [timelineExtraItems, setTimelineExtraItems] = useState<ProjectActivity[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineCursor, setTimelineCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(
    null,
  );
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineReady, setTimelineReady] = useState(false);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(true);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(true);
  const [isSalesOrderModalOpen, setIsSalesOrderModalOpen] = useState(false);
  const [isSalesOrderSubmitting, setIsSalesOrderSubmitting] = useState(false);
  const [salesOrderError, setSalesOrderError] = useState<string | null>(null);
  const [salesOrderSuccess, setSalesOrderSuccess] = useState<string | null>(null);
  const [salesOrderFormState, setSalesOrderFormState] = useState<SalesOrderRequestFormState>(() =>
    emptySalesOrderForm(),
  );

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'project_view']);
  const hasUserVisibility = hasUserVisibilityAccess(user, 'projects', user?.roleRelations);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'project_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'project_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'project_delete']);
  const canOpenDetails = canView;
  const canCreateTasks = !!user && hasPermission(user.permissions, ['admin', 'task_create']);
  const canEditTasks = !!user && hasPermission(user.permissions, ['admin', 'task_edit']);
  const canAssignTasks = !!user && hasPermission(user.permissions, ['admin', 'task_assign']);
  const canReassignProjectTasks = canAssignTasks;
  const canRequestSalesOrder =
    !!user && hasPermission(user.permissions, ['admin', 'sales_order_request_create']);
  const canViewAllCustomers =
    !!user && hasPermission(user.permissions, ['admin', 'customer_view_all']);

  const emptyProject = (assignedTo: string): ProjectFormState => ({
    name: '',
    customerId: '',
    customerName: '',
    assignedTo,
    startDate: todayKey(),
    dueDate: todayKey(),
    value: '',
    status: 'not-started',
    description: '',
    sharedRoles: [],
  });

  const buildProjectFormState = (project: Project): ProjectFormState => ({
    name: project.name,
    customerId: project.customerId,
    customerName: project.customerName,
    assignedTo: project.assignedTo,
    startDate: project.startDate,
    dueDate: project.dueDate,
    value: String(project.value ?? ''),
    status: project.status,
    description: project.description,
    sharedRoles: project.sharedRoles ?? [],
  });

  const [formState, setFormState] = useState<ProjectFormState>(() => emptyProject(user?.id ?? ''));

  const emptyTask = (): ProjectTaskFormState => ({
    title: '',
    description: '',
    assignedUsers: [],
    status: 'todo',
    priority: 'medium',
    dueDate: '',
    referenceModelNumber: '',
    estimateNumber: '',
    estimateAmount: '',
    isRevision: false,
    revisionNumber: '',
  });

  const buildProjectTaskFormState = (task: Task): ProjectTaskFormState => ({
    title: task.title,
    description: task.description,
    assignedUsers: task.assignedUsers ?? (task.assignedTo ? [task.assignedTo] : []),
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
    referenceModelNumber: task.referenceModelNumber ?? '',
    estimateNumber: task.estimateNumber ?? '',
    estimateAmount:
      typeof task.estimateAmount === 'number' && Number.isFinite(task.estimateAmount)
        ? String(task.estimateAmount)
        : '',
    isRevision: task.isRevision === true,
    revisionNumber: task.revisionNumber ?? '',
  });

  const [taskFormState, setTaskFormState] = useState<ProjectTaskFormState>(() => emptyTask());

  const getProjectDraftStorageKey = useCallback(
    (projectId: string | null) => {
      if (!user) {
        return null;
      }
      return [PROJECT_MODAL_DRAFT_STORAGE_KEY, user.id, projectId ?? 'new'].join(':');
    },
    [user],
  );

  const readProjectDraft = useCallback(
    (projectId: string | null) => {
      const storageKey = getProjectDraftStorageKey(projectId);
      if (!storageKey || typeof window === 'undefined') {
        return null;
      }
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw) as Partial<ProjectFormState>;
      } catch {
        return null;
      }
    },
    [getProjectDraftStorageKey],
  );

  const clearProjectDraft = useCallback(
    (projectId: string | null) => {
      const storageKey = getProjectDraftStorageKey(projectId);
      if (!storageKey || typeof window === 'undefined') {
        return;
      }
      window.localStorage.removeItem(storageKey);
    },
    [getProjectDraftStorageKey],
  );

  const getProjectTaskDraftStorageKey = useCallback(
    (projectId: string, taskId: string | null) => {
      if (!user) {
        return null;
      }
      return [PROJECT_TASK_MODAL_DRAFT_STORAGE_KEY, user.id, projectId, taskId ?? 'new'].join(':');
    },
    [user],
  );

  const readProjectTaskDraft = useCallback(
    (projectId: string, taskId: string | null) => {
      const storageKey = getProjectTaskDraftStorageKey(projectId, taskId);
      if (!storageKey || typeof window === 'undefined') {
        return null;
      }
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw) as Partial<ProjectTaskFormState>;
      } catch {
        return null;
      }
    },
    [getProjectTaskDraftStorageKey],
  );

  const clearProjectTaskDraft = useCallback(
    (projectId: string, taskId: string | null) => {
      const storageKey = getProjectTaskDraftStorageKey(projectId, taskId);
      if (!storageKey || typeof window === 'undefined') {
        return;
      }
      window.localStorage.removeItem(storageKey);
    },
    [getProjectTaskDraftStorageKey],
  );

  const getProjectSalesOrderDraftStorageKey = useCallback(
    (projectId: string) => {
      if (!user) {
        return null;
      }
      return [PROJECT_SALES_ORDER_MODAL_DRAFT_STORAGE_KEY, user.id, projectId].join(':');
    },
    [user],
  );

  const readProjectSalesOrderDraft = useCallback(
    (projectId: string) => {
      const storageKey = getProjectSalesOrderDraftStorageKey(projectId);
      if (!storageKey || typeof window === 'undefined') {
        return null;
      }
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return null;
        }
        return JSON.parse(raw) as Partial<SalesOrderRequestFormState>;
      } catch {
        return null;
      }
    },
    [getProjectSalesOrderDraftStorageKey],
  );

  const clearProjectSalesOrderDraft = useCallback(
    (projectId: string) => {
      const storageKey = getProjectSalesOrderDraftStorageKey(projectId);
      if (!storageKey || typeof window === 'undefined') {
        return;
      }
      window.localStorage.removeItem(storageKey);
    },
    [getProjectSalesOrderDraftStorageKey],
  );

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const userRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((profile) => map.set(profile.id, profile.role));
    if (user) {
      map.set(user.id, user.role);
    }
    return map;
  }, [user, users]);

  const visibleUsers = useMemo(
    () => filterUsersByRole(user, users, 'projects', user?.roleRelations),
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
  const projectsCacheKey = useMemo(() => {
    if (!user) {
      return null;
    }
    const scopeKey = isAdmin
      ? 'admin'
      : hasUserVisibility
        ? `visible:${visibleUserScope}`
        : `self:${user.id}`;
    return ['projects', user.id, ownerFilter, scopeKey].join(':');
  }, [user, ownerFilter, isAdmin, hasUserVisibility, visibleUserScope]);
  const cachedProjectsEntry = projectsCacheKey
    ? getModuleCacheEntry<Project[]>(projectsCacheKey)
    : null;
  const [projects, setProjects] = useState<Project[]>(() => cachedProjectsEntry?.data ?? []);
  const [loading, setLoading] = useState(() => !cachedProjectsEntry);

  const assigneeOptions = useMemo(() => {
    if (!canAssignTasks) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return filterAssignableUsers(users, roles, 'task_assign', {
      currentUser: user,
      moduleKey: 'tasks',
    }).map((entry) => ({
      id: entry.id,
      name: entry.fullName,
    }));
  }, [user, users, roles, canAssignTasks]);

  const syncProjects = useCallback(
    (next: Project[]) => {
      setProjects(next);
      if (projectsCacheKey) {
        setModuleCacheEntry(projectsCacheKey, next);
      }
    },
    [projectsCacheKey],
  );

  const updateProjects = (updater: (current: Project[]) => Project[]) => {
    setProjects((current) => {
      const next = updater(current);
      if (projectsCacheKey) {
        setModuleCacheEntry(projectsCacheKey, next);
      }
      return next;
    });
  };

  const timelineItems = useMemo(
    () => [...timelineBaseItems, ...timelineExtraItems],
    [timelineBaseItems, timelineExtraItems],
  );

  useEffect(() => {
    if (!user || !(hasUserVisibility || canAssignTasks)) {
      setUsers([]);
      setRoles([]);
      return;
    }
    const loadUsers = async () => {
      const usersCacheKey = 'projects-users';
      const rolesCacheKey = 'projects-roles';
      const cachedUsersEntry = getModuleCacheEntry<User[]>(usersCacheKey);
      const cachedRolesEntry = getModuleCacheEntry<RoleSummary[]>(rolesCacheKey);
      if (cachedUsersEntry) {
        setUsers(cachedUsersEntry.data);
      }
      if (cachedRolesEntry) {
        setRoles(cachedRolesEntry.data);
      }
      if (
        cachedUsersEntry &&
        cachedRolesEntry &&
        isModuleCacheFresh(cachedUsersEntry, MODULE_CACHE_TTL_MS) &&
        isModuleCacheFresh(cachedRolesEntry, MODULE_CACHE_TTL_MS)
      ) {
        return;
      }
      try {
        const [result, roleSummaries] = await Promise.all([
          firebaseUserRepository.listAll(),
          fetchRoleSummaries(),
        ]);
        setUsers(result);
        setRoles(roleSummaries);
        setModuleCacheEntry(usersCacheKey, result);
        setModuleCacheEntry(rolesCacheKey, roleSummaries);
      } catch {
        setUsers([]);
        setRoles([]);
      }
    };
    loadUsers();
  }, [user, hasUserVisibility, canAssignTasks]);

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
    const loadCustomers = async () => {
      if (!user) {
        setCustomers([]);
        return;
      }
      const customersCacheKey = ['projects-customers', user.id, isAdmin ? 'admin' : user.role].join(
        ':',
      );
      const cachedEntry = getModuleCacheEntry<Customer[]>(customersCacheKey);
      if (cachedEntry) {
        setCustomers(cachedEntry.data);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        if (canViewAllCustomers || isAdmin) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          setCustomers(allCustomers);
          setModuleCacheEntry(customersCacheKey, allCustomers);
          return;
        }
        const result = await firebaseCustomerRepository.listForUser(user.id, user.role);
        setCustomers(result);
        setModuleCacheEntry(customersCacheKey, result);
      } catch {
        setCustomers([]);
      }
    };
    loadCustomers();
  }, [user, isAdmin, canViewAllCustomers]);

  useEffect(() => {
    const cachedEntry = projectsCacheKey ? getModuleCacheEntry<Project[]>(projectsCacheKey) : null;
    if (!cachedEntry) {
      return;
    }
    setProjects(cachedEntry.data);
    setLoading(false);
  }, [projectsCacheKey]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!user) {
        setProjects([]);
        setLoading(false);
        return;
      }
      if (!canView) {
        setProjects([]);
        setLoading(false);
        return;
      }
      const cachedEntry = projectsCacheKey
        ? getModuleCacheEntry<Project[]>(projectsCacheKey)
        : null;
      if (cachedEntry) {
        setProjects(cachedEntry.data);
        setLoading(false);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        let nextProjects: Project[] = [];
        if (user.permissions.includes('admin')) {
          const allProjects = await firebaseProjectRepository.listAll();
          if (ownerFilter === 'all') {
            nextProjects = allProjects;
          } else {
            const selectedRole = userRoleMap.get(ownerFilter);
            nextProjects = allProjects.filter(
              (project) =>
                project.assignedTo === ownerFilter ||
                (selectedRole ? project.sharedRoles.includes(selectedRole) : false),
            );
          }
        } else if (hasUserVisibility) {
          const allProjects = await firebaseProjectRepository.listAll();
          const sameRoleProjects = allProjects.filter((project) =>
            visibleUserIds.has(project.assignedTo),
          );
          if (ownerFilter === 'all') {
            nextProjects = sameRoleProjects;
          } else {
            const selectedRole = userRoleMap.get(ownerFilter);
            nextProjects = sameRoleProjects.filter(
              (project) =>
                project.assignedTo === ownerFilter ||
                (selectedRole ? project.sharedRoles.includes(selectedRole) : false),
            );
          }
        } else {
          nextProjects = await firebaseProjectRepository.listForUser(user.id, user.role);
        }
        syncProjects(nextProjects);
      } catch {
        setError('Unable to load projects. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadProjects();
  }, [
    user,
    canView,
    hasUserVisibility,
    ownerFilter,
    userRoleMap,
    visibleUserIds,
    projectsCacheKey,
    syncProjects,
  ]);

  useEffect(() => {
    if (!isViewOpen || !selectedProject) {
      setProjectTasks([]);
      setTaskError(null);
      return;
    }
    const tasksRef = collection(getFirebaseDb(), 'tasks');
    const tasksQuery = query(tasksRef, where('projectId', '==', selectedProject.id));
    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        const items = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Task, 'id'>),
          }))
          .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        setProjectTasks(items);
      },
      () => {
        setProjectTasks([]);
        setTaskError('Unable to load tasks.');
      },
    );
    return () => unsubscribe();
  }, [isViewOpen, selectedProject]);

  useEffect(() => {
    if (!isViewOpen || !selectedProject) {
      setTimelineReady(false);
      setTimelineBaseItems([]);
      setTimelineExtraItems([]);
      setTimelineError(null);
      setTimelineCursor(null);
      setTimelineHasMore(false);
      setTimelineLoading(false);
      setTimelineLoadingMore(false);
      return;
    }
    setTimelineReady(false);
    setTimelineBaseItems([]);
    setTimelineExtraItems([]);
    setTimelineError(null);
    setTimelineCursor(null);
    setTimelineHasMore(false);
    setTimelineLoading(true);
    setTimelineLoadingMore(false);
    const idleCallback = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    const cancelIdleCallback = (
      window as Window & {
        cancelIdleCallback?: (id: number) => void;
      }
    ).cancelIdleCallback;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (idleCallback) {
      idleId = idleCallback(() => setTimelineReady(true), { timeout: 1200 });
    } else {
      timeoutId = setTimeout(() => setTimelineReady(true), 200);
    }
    return () => {
      if (idleId && cancelIdleCallback) {
        cancelIdleCallback(idleId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isViewOpen, selectedProject]);

  useEffect(() => {
    if (!timelineReady || !selectedProject) {
      return;
    }
    const activitiesRef = collection(
      getFirebaseDb(),
      'sales',
      'main',
      'projects',
      selectedProject.id,
      'activities',
    );
    const baseQuery = query(activitiesRef, orderBy('date', 'desc'), limit(TIMELINE_PAGE_SIZE));
    const unsubscribe = onSnapshot(
      baseQuery,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Partial<ProjectActivity>;
          const note = typeof data.note === 'string' && data.note.trim() ? data.note : 'Updated';
          return {
            id: docSnap.id,
            note,
            date: typeof data.date === 'string' ? data.date : '',
            createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
            type: typeof data.type === 'string' ? data.type : undefined,
          };
        });
        setTimelineBaseItems(items);
        setTimelineCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
        setTimelineHasMore(snapshot.docs.length === TIMELINE_PAGE_SIZE);
        setTimelineLoading(false);
      },
      () => {
        setTimelineError('Unable to load activity. Please try again.');
        setTimelineBaseItems([]);
        setTimelineExtraItems([]);
        setTimelineLoading(false);
        setTimelineHasMore(false);
      },
    );
    return () => {
      unsubscribe();
    };
  }, [timelineReady, selectedProject]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = statusFilter === 'all' ? true : project.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [project.name, project.customerName].some((value) => value.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, statusFilter]);

  const totals = useMemo(() => {
    const notStarted = projects.filter((project) => project.status === 'not-started').length;
    const inProgress = projects.filter((project) => project.status === 'in-progress').length;
    const onHold = projects.filter((project) => project.status === 'on-hold').length;
    const completed = projects.filter((project) => project.status === 'completed').length;
    return { notStarted, inProgress, onHold, completed };
  }, [projects]);
  const projectStatusFilterOptions = [
    'all',
    ...statusOptions.map((status) => status.value),
  ] as const;
  const selectedProjectStatusIndex = Math.max(0, projectStatusFilterOptions.indexOf(statusFilter));

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedProject(null);
    const baseState = emptyProject(user.id);
    const draft = readProjectDraft(null);
    setFormState(draft ? { ...baseState, ...draft } : baseState);
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (project: Project) => {
    setSelectedProject(project);
    const baseState = buildProjectFormState(project);
    const draft = readProjectDraft(project.id);
    setFormState(draft ? { ...baseState, ...draft } : baseState);
    setIsEditOpen(true);
  };

  const handleEntryOpen = (project: Project) => {
    if (!canOpenDetails) {
      return;
    }
    setSelectedProject(project);
    setProjectDetailsView('general');
    setIsViewOpen(true);
  };

  const handleEntryKeyDown = (event: React.KeyboardEvent<HTMLElement>, project: Project) => {
    if (!canOpenDetails) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleEntryOpen(project);
    }
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
    setIsViewOpen(false);
    setProjectDetailsView('general');
    setIsTaskModalOpen(false);
    setIsSalesOrderModalOpen(false);
    setSelectedTask(null);
    setSalesOrderError(null);
    setSalesOrderSuccess(null);
  };

  const handleOpenSalesOrderModal = (sourceTask?: Task) => {
    if (!selectedProject || !canRequestSalesOrder) {
      return;
    }
    const hasEstimateDetails = (task: Task) =>
      !!task.estimateNumber &&
      typeof task.estimateAmount === 'number' &&
      Number.isFinite(task.estimateAmount) &&
      task.estimateAmount > 0;

    const fallbackEstimateTask = projectTasks.find(
      (task) => isEstimateProjectTask(task) && hasEstimateDetails(task),
    );
    const prefillTask =
      sourceTask && isEstimateProjectTask(sourceTask) && hasEstimateDetails(sourceTask)
        ? sourceTask
        : fallbackEstimateTask;

    const baseForm = emptySalesOrderForm();
    const draft = readProjectSalesOrderDraft(selectedProject.id);
    setSalesOrderFormState({
      ...baseForm,
      estimateNumber: prefillTask?.estimateNumber ?? '',
      estimateAmount:
        typeof prefillTask?.estimateAmount === 'number' &&
        Number.isFinite(prefillTask.estimateAmount)
          ? String(prefillTask.estimateAmount)
          : '',
      ...draft,
    });
    setSalesOrderError(null);
    setSalesOrderSuccess(null);
    setIsSalesOrderModalOpen(true);
  };

  const handleSubmitSalesOrderRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !selectedProject || !canRequestSalesOrder) {
      return;
    }
    const estimateNumber = salesOrderFormState.estimateNumber.trim();
    const salesOrderNumber = salesOrderFormState.salesOrderNumber.trim();
    const salesOrderDate = salesOrderFormState.salesOrderDate.trim();
    const estimateAmount = Number(salesOrderFormState.estimateAmount);
    const salesOrderAmount = Number(salesOrderFormState.salesOrderAmount);

    if (!estimateNumber) {
      setSalesOrderError('Estimate number is required.');
      return;
    }
    if (!Number.isFinite(estimateAmount) || estimateAmount <= 0) {
      setSalesOrderError('Estimate amount must be greater than 0.');
      return;
    }
    if (!salesOrderNumber) {
      setSalesOrderError('Sales Order number is required.');
      return;
    }
    if (!Number.isFinite(salesOrderAmount) || salesOrderAmount <= 0) {
      setSalesOrderError('Sales Order amount must be greater than 0.');
      return;
    }
    if (!salesOrderDate) {
      setSalesOrderError('Sales Order date is required.');
      return;
    }
    setIsSalesOrderSubmitting(true);
    setSalesOrderError(null);
    setSalesOrderSuccess(null);
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setSalesOrderError('You must be signed in to submit Sales Order Reqs.');
        return;
      }
      const idToken = await currentUser.getIdToken();
      const payload = JSON.stringify({
        projectId: selectedProject.id,
        estimateNumber,
        estimateAmount,
        salesOrderNumber,
        salesOrderAmount,
        salesOrderDate,
      });
      const endpoints = [
        '/api/sales-order/sales-order-requests',
        '/api/sales-order/requests',
        '/api/sales-order-requests',
      ];
      let response: Response | null = null;
      for (const endpoint of endpoints) {
        const candidate = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: payload,
        });
        response = candidate;
        if (candidate.status !== 404) {
          break;
        }
      }
      if (!response) {
        setSalesOrderError('Unable to submit Sales Order Req (no response).');
        return;
      }
      let data: { id?: string; error?: string; requestNo?: string } = {};
      try {
        data = (await response.json()) as { id?: string; error?: string; requestNo?: string };
      } catch {
        data = {};
      }
      if (!response.ok) {
        setSalesOrderError(
          data.error ?? `Unable to submit Sales Order Req (HTTP ${response.status}).`,
        );
        return;
      }

      const requestNo = data.requestNo ?? 'Sales Order Req';
      setSalesOrderSuccess(`${requestNo} submitted for approval.`);
      clearProjectSalesOrderDraft(selectedProject.id);
      setSalesOrderFormState(emptySalesOrderForm());
    } catch {
      setSalesOrderError('Unable to submit Sales Order Req. Please try again.');
    } finally {
      setIsSalesOrderSubmitting(false);
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) {
      return;
    }
    setFormState((prev) => ({
      ...prev,
      customerId: customer.id,
      customerName: customer.companyName,
      assignedTo: customer.assignedTo,
      sharedRoles: customer.sharedRoles ?? [],
    }));
  };

  const formatAssigneeNames = (ids: string[]) => {
    if (ids.length === 0) {
      return 'Unassigned';
    }
    return ids
      .map((id) => ownerNameMap.get(id) ?? id)
      .filter(Boolean)
      .join(', ');
  };

  const logProjectActivity = async (projectId: string, note: string, type: string = 'note') => {
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

  const handleOpenTaskModal = (task?: Task) => {
    const taskAssignees = task?.assignedUsers ?? (task?.assignedTo ? [task.assignedTo] : []);
    const canEditEstimateOnly =
      !!task && !!user && (task.assignedTo === user.id || taskAssignees.includes(user.id));
    if (task && !canEditTasks && !canEditEstimateOnly) {
      return;
    }
    if (!task && !canCreateTasks) {
      return;
    }
    setTaskError(null);
    if (task) {
      setSelectedTask(task);
      const baseState = buildProjectTaskFormState(task);
      const draft = selectedProject ? readProjectTaskDraft(selectedProject.id, task.id) : null;
      setTaskFormState(draft ? { ...baseState, ...draft } : baseState);
    } else {
      setSelectedTask(null);
      const baseState = emptyTask();
      const draft = selectedProject ? readProjectTaskDraft(selectedProject.id, null) : null;
      setTaskFormState(draft ? { ...baseState, ...draft } : baseState);
    }
    setIsTaskModalOpen(true);
  };

  const handleCloseTaskModal = () => {
    setIsTaskModalOpen(false);
  };

  useEffect(() => {
    if (!(isCreateOpen || isEditOpen) || !user || typeof window === 'undefined') {
      return;
    }
    const storageKey = getProjectDraftStorageKey(selectedProject?.id ?? null);
    if (!storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(formState));
    } catch {
      // Ignore storage write failures and keep the in-memory form usable.
    }
  }, [formState, getProjectDraftStorageKey, isCreateOpen, isEditOpen, selectedProject, user]);

  useEffect(() => {
    if (!isTaskModalOpen || !selectedProject || !user || typeof window === 'undefined') {
      return;
    }
    const storageKey = getProjectTaskDraftStorageKey(selectedProject.id, selectedTask?.id ?? null);
    if (!storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(taskFormState));
    } catch {
      // Ignore storage write failures and keep the in-memory form usable.
    }
  }, [
    getProjectTaskDraftStorageKey,
    isTaskModalOpen,
    selectedProject,
    selectedTask,
    taskFormState,
    user,
  ]);

  useEffect(() => {
    if (!isSalesOrderModalOpen || !selectedProject || !user || typeof window === 'undefined') {
      return;
    }
    const storageKey = getProjectSalesOrderDraftStorageKey(selectedProject.id);
    if (!storageKey) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(salesOrderFormState));
    } catch {
      // Ignore storage write failures and keep the in-memory form usable.
    }
  }, [
    getProjectSalesOrderDraftStorageKey,
    isSalesOrderModalOpen,
    salesOrderFormState,
    selectedProject,
    user,
  ]);

  const handleSaveTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !selectedProject) {
      return;
    }
    const selectedTaskAssignees =
      selectedTask?.assignedUsers ?? (selectedTask?.assignedTo ? [selectedTask.assignedTo] : []);
    const canEditAsParticipant =
      !!selectedTask &&
      !!user &&
      (selectedTask.assignedTo === user.id ||
        selectedTaskAssignees.includes(user.id) ||
        selectedTask.createdBy === user.id);
    const canEditEstimateOnly =
      !!selectedTask &&
      !!user &&
      (selectedTask.assignedTo === user.id || selectedTaskAssignees.includes(user.id));
    const isAssignedSelectedTask = isAssignedTask(selectedTask);
    const isEstimateTask = isEstimateProjectTask(selectedTask);
    if (selectedTask && !canEditTasks && !canEditEstimateOnly && !canEditAsParticipant) {
      setTaskError('You do not have permission to edit tasks.');
      return;
    }
    if (!selectedTask && !canCreateTasks) {
      setTaskError('You do not have permission to create tasks.');
      return;
    }
    if (!taskFormState.title.trim()) {
      setTaskError('Task title is required.');
      return;
    }
    setIsTaskSaving(true);
    setTaskError(null);
    const assignedUsers = taskFormState.assignedUsers.filter(Boolean);
    const assignedTo = assignedUsers[0] ?? '';
    if (selectedTask && !isAdmin) {
      const previousAssignees = Array.from(new Set(selectedTaskAssignees.filter(Boolean)));
      const nextAssignees = Array.from(new Set(assignedUsers));
      const assignmentChanged =
        selectedTask.assignedTo !== assignedTo ||
        !areSameRecipientSets(previousAssignees, nextAssignees);
      if (assignmentChanged) {
        setTaskError('Only admins can reassign tasks after assignment.');
        setIsTaskSaving(false);
        return;
      }
    }
    const canEditEstimateDetails =
      isEstimateTask && !!user && (assignedTo === user.id || assignedUsers.includes(user.id));
    const estimateNumber = taskFormState.estimateNumber.trim();
    const estimateAmountRaw = taskFormState.estimateAmount.trim();
    const estimateAmount = estimateAmountRaw.length > 0 ? Number(estimateAmountRaw) : null;
    const revisionNumber = taskFormState.revisionNumber.trim();
    if (taskFormState.isRevision && !revisionNumber) {
      setTaskError('Revision number is required when marked as revision.');
      setIsTaskSaving(false);
      return;
    }
    if (!taskFormState.isRevision && revisionNumber.length > 0) {
      setTaskError('Enable "Mark as Revision" to set a revision number.');
      setIsTaskSaving(false);
      return;
    }
    if (canEditEstimateDetails) {
      if (
        (estimateNumber.length > 0 && estimateAmountRaw.length === 0) ||
        (estimateNumber.length === 0 && estimateAmountRaw.length > 0)
      ) {
        setTaskError('Provide both Estimate No and Estimate Amount.');
        setIsTaskSaving(false);
        return;
      }
      if (
        estimateAmountRaw.length > 0 &&
        (!Number.isFinite(estimateAmount) || estimateAmount === null || estimateAmount <= 0)
      ) {
        setTaskError('Estimate amount must be greater than 0.');
        setIsTaskSaving(false);
        return;
      }
    }
    const estimatePayload =
      canEditEstimateDetails && estimateNumber.length > 0 && estimateAmount !== null
        ? {
            estimateNumber,
            estimateAmount,
          }
        : {};
    try {
      if (selectedTask) {
        if (!canEditTasks && canEditEstimateOnly && isEstimateTask) {
          const updated = await firebaseTaskRepository.update(selectedTask.id, {
            ...estimatePayload,
            updatedAt: new Date().toISOString(),
          });
          clearProjectTaskDraft(selectedProject.id, selectedTask.id);
          setProjectTasks((prev) =>
            prev.map((item) => (item.id === selectedTask.id ? updated : item)),
          );
          await logProjectActivity(
            selectedProject.id,
            `Estimate details updated for task: ${updated.title}.`,
            'task',
          );
          setIsTaskModalOpen(false);
          return;
        }
        const previous = selectedTask;
        const estimateFlag =
          previous.isEstimateTemplateTask === true ||
          previous.title.trim().toLowerCase() === 'estimate';
        const updated = await firebaseTaskRepository.update(selectedTask.id, {
          title: taskFormState.title.trim(),
          description: taskFormState.description.trim(),
          assignedUsers,
          assignedTo,
          projectId: selectedProject.id,
          status: taskFormState.status,
          priority: isAssignedSelectedTask ? selectedTask.priority : taskFormState.priority,
          dueDate: isAssignedSelectedTask ? selectedTask.dueDate : taskFormState.dueDate,
          referenceModelNumber: taskFormState.referenceModelNumber.trim(),
          isRevision: taskFormState.isRevision,
          revisionNumber: taskFormState.isRevision ? revisionNumber : '',
          ...estimatePayload,
          isEstimateTemplateTask: estimateFlag,
          updatedAt: new Date().toISOString(),
        });
        clearProjectTaskDraft(selectedProject.id, selectedTask.id);
        const previousAssignees =
          previous.assignedUsers ?? (previous.assignedTo ? [previous.assignedTo] : []);
        const assignmentChanged =
          previous.assignedTo !== assignedTo ||
          !areSameRecipientSets(previousAssignees, assignedUsers);
        if (assignmentChanged) {
          const recipients = buildAssignedRecipients(assignedUsers, user.id);
          await emitNotificationEventSafe({
            type: 'task.assigned',
            title: 'New Task Assignment',
            body: `${user.fullName} assigned: ${updated.title}.`,
            actorId: user.id,
            recipients,
            entityType: 'task',
            entityId: updated.id,
            requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
            meta: {
              assignedTo,
              projectId: selectedProject.id,
            },
          });
        }
        if (previous.status !== updated.status) {
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
            requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
            meta: {
              status: updated.status,
              projectId: selectedProject.id,
            },
          });
        }
        const taskChanges: string[] = [];
        if (previous.title !== updated.title) {
          taskChanges.push(`Title updated to ${updated.title}.`);
        }
        if (previous.status !== updated.status) {
          taskChanges.push(`Status updated to ${updated.status.replace('-', ' ')}.`);
          if (updated.status === 'done') {
            taskChanges.push('Task completed.');
          }
        }
        if (previous.description?.trim() !== updated.description?.trim()) {
          taskChanges.push('Description updated.');
        }
        if (previous.priority !== updated.priority) {
          taskChanges.push(`Priority updated to ${updated.priority}.`);
        }
        if ((previous.dueDate ?? '') !== (updated.dueDate ?? '')) {
          taskChanges.push(
            `Due date updated to ${updated.dueDate ? formatDate(updated.dueDate) : 'None'}.`,
          );
        }
        if ((previous.referenceModelNumber ?? '') !== (updated.referenceModelNumber ?? '')) {
          taskChanges.push(
            `Reference Model Number updated to ${updated.referenceModelNumber || 'None'}.`,
          );
        }
        if (previousAssignees.join('|') !== assignedUsers.join('|')) {
          taskChanges.push(`Assignees updated to ${formatAssigneeNames(assignedUsers)}.`);
        }
        if (taskChanges.length > 0) {
          await logProjectActivity(
            selectedProject.id,
            `Task updated: ${updated.title}. ${taskChanges.join(' ')}`,
            'task',
          );
        }
      } else {
        const created = await firebaseTaskRepository.create({
          title: taskFormState.title.trim(),
          description: taskFormState.description.trim(),
          assignedTo,
          assignedUsers,
          status: taskFormState.status,
          priority: taskFormState.priority,
          recurrence: 'none',
          quotationNumber: '',
          startDate: todayKey(),
          endDate: todayKey(),
          dueDate: taskFormState.dueDate,
          parentTaskId: '',
          projectId: selectedProject.id,
          referenceModelNumber: taskFormState.referenceModelNumber.trim(),
          isRevision: taskFormState.isRevision,
          revisionNumber: taskFormState.isRevision ? revisionNumber : '',
          ...estimatePayload,
          sharedRoles: [],
          createdBy: user.id,
        });
        clearProjectTaskDraft(selectedProject.id, null);
        const recipients = buildAssignedRecipients(assignedUsers, user.id);
        await emitNotificationEventSafe({
          type: 'task.assigned',
          title: 'New Task',
          body: `${user.fullName} assigned: ${created.title}.`,
          actorId: user.id,
          recipients,
          entityType: 'task',
          entityId: created.id,
          requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
          meta: {
            projectId: selectedProject.id,
          },
        });
        await logProjectActivity(
          selectedProject.id,
          `Task created: ${created.title}. Assignees: ${formatAssigneeNames(assignedUsers)}.`,
          'task',
        );
      }
      setIsTaskModalOpen(false);
    } catch {
      setTaskError('Unable to save task. Please try again.');
    } finally {
      setIsTaskSaving(false);
    }
  };

  const handleCreateFromTemplate = async (template: { title: string; description: string }) => {
    if (!user || !selectedProject) {
      return;
    }
    if (!canCreateTasks) {
      setTaskError('You do not have permission to create tasks.');
      return;
    }
    try {
      const created = await firebaseTaskRepository.create({
        title: template.title,
        description: template.description,
        assignedTo: '',
        assignedUsers: [],
        status: 'todo',
        priority: 'medium',
        recurrence: 'none',
        quotationNumber: '',
        startDate: todayKey(),
        endDate: todayKey(),
        dueDate: '',
        parentTaskId: '',
        projectId: selectedProject.id,
        referenceModelNumber: '',
        isEstimateTemplateTask: template.title.trim().toLowerCase() === 'estimate',
        sharedRoles: [],
        createdBy: user.id,
      });
      await logProjectActivity(
        selectedProject.id,
        `Template task created: ${created.title}.`,
        'task',
      );
    } catch {
      setTaskError('Unable to create template task.');
    }
  };

  const handleDeleteTask = async (task: Task) => {
    if (!user || !selectedProject) {
      return;
    }
    if (!canEditTasks) {
      setTaskError('You do not have permission to delete tasks.');
      return;
    }
    const confirmed = window.confirm('Delete this task? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setTaskError(null);
    try {
      await firebaseTaskRepository.delete(task.id);
      await logProjectActivity(selectedProject.id, `Task deleted: ${task.title}.`, 'task');
    } catch {
      setTaskError('Unable to delete task. Please try again.');
    }
  };

  const handleAssignTask = async (task: Task, assigneeId: string) => {
    if (!user || !selectedProject) {
      return;
    }
    if (!canEditTasks || !canAssignTasks) {
      setTaskError('You do not have permission to assign tasks.');
      return;
    }
    const assignedUsers = assigneeId ? [assigneeId] : [];
    const assignedTo = assigneeId ?? '';
    try {
      const updated = await firebaseTaskRepository.update(task.id, {
        assignedUsers,
        assignedTo,
        updatedAt: new Date().toISOString(),
      });
      setProjectTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      const recipients = buildAssignedRecipients(assignedUsers, user.id);
      await emitNotificationEventSafe({
        type: 'task.assigned',
        title: 'New Task Assignment',
        body: `${user.fullName} assigned: ${updated.title}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
        meta: {
          assignedTo,
          projectId: selectedProject.id,
        },
      });
      await logProjectActivity(
        selectedProject.id,
        `Task updated: ${updated.title}. Assignees updated to ${formatAssigneeNames(
          assignedUsers,
        )}.`,
        'task',
      );
    } catch {
      setTaskError('Unable to assign task. Please try again.');
    }
  };

  const handleUpdateTaskDueDate = async (task: Task, dueDate: string) => {
    if (!user || !selectedProject) {
      return;
    }
    if (!canEditTasks) {
      setTaskError('You do not have permission to edit tasks.');
      return;
    }
    if (isAssignedTask(task)) {
      setTaskError('Due date cannot be changed once a task is assigned.');
      return;
    }
    try {
      const updated = await firebaseTaskRepository.update(task.id, {
        dueDate,
        updatedAt: new Date().toISOString(),
      });
      setProjectTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      await logProjectActivity(
        selectedProject.id,
        `Task updated: ${updated.title}. Due date updated to ${
          updated.dueDate ? formatDate(updated.dueDate) : 'None'
        }.`,
        'task',
      );
    } catch {
      setTaskError('Unable to update due date. Please try again.');
    }
  };

  const handleLoadMoreTimeline = async () => {
    if (!selectedProject || !timelineCursor || timelineLoadingMore) {
      return;
    }
    setTimelineLoadingMore(true);
    setTimelineError(null);
    try {
      const activitiesRef = collection(
        getFirebaseDb(),
        'sales',
        'main',
        'projects',
        selectedProject.id,
        'activities',
      );
      const nextQuery = query(
        activitiesRef,
        orderBy('date', 'desc'),
        startAfter(timelineCursor),
        limit(TIMELINE_PAGE_SIZE),
      );
      const snapshot = await getDocs(nextQuery);
      const items = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Partial<ProjectActivity>;
        const note = typeof data.note === 'string' && data.note.trim() ? data.note : 'Updated';
        return {
          id: docSnap.id,
          note,
          date: typeof data.date === 'string' ? data.date : '',
          createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
          type: typeof data.type === 'string' ? data.type : undefined,
        };
      });
      setTimelineExtraItems((prev) => [...prev, ...items]);
      setTimelineCursor(snapshot.docs[snapshot.docs.length - 1] ?? timelineCursor);
      setTimelineHasMore(snapshot.docs.length === TIMELINE_PAGE_SIZE);
    } catch {
      setTimelineError('Unable to load more activity. Please try again.');
    } finally {
      setTimelineLoadingMore(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save projects.');
      return;
    }
    if (!formState.name.trim() || !formState.customerId) {
      setError('Project name and customer are required.');
      return;
    }
    const isEditing = !!selectedProject;
    if (isEditing && !canEdit) {
      setError('You do not have permission to edit projects.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create projects.');
      return;
    }
    if (isEditing && !isAdmin && selectedProject?.assignedTo !== user.id) {
      setError('You can only edit projects assigned to you.');
      return;
    }

    const updates = {
      ...formState,
      name: formState.name.trim(),
      description: formState.description.trim(),
      value: Number(formState.value) || 0,
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && selectedProject) {
        const previous = selectedProject;
        const updated = await firebaseProjectRepository.update(selectedProject.id, {
          ...updates,
          updatedAt: new Date().toISOString(),
        });
        clearProjectDraft(selectedProject.id);
        updateProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        if (previous.assignedTo !== updated.assignedTo) {
          await emitNotificationEventSafe({
            type: 'project.assigned',
            title: 'Project Assigned',
            body: `${user.fullName} assigned you to ${updated.name}.`,
            actorId: user.id,
            recipients: buildRecipientList(updated.assignedTo, [], user.id),
            entityType: 'project',
            entityId: updated.id,
            requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
            meta: {
              status: updated.status,
            },
          });
        }
        if (previous.status !== updated.status) {
          await emitNotificationEventSafe({
            type: 'project.status_changed',
            title: 'Project Status Updated',
            body: `${user.fullName} changed ${updated.name} to ${formatStatusLabel(
              updated.status,
            )}.`,
            actorId: user.id,
            recipients: buildRecipientList(updated.createdBy, [updated.assignedTo], user.id),
            entityType: 'project',
            entityId: updated.id,
            requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
            meta: {
              status: updated.status,
            },
          });
        }
        const changes: string[] = [];
        if (previous.name !== updated.name) {
          changes.push(`Name updated to ${updated.name}.`);
        }
        if (previous.customerName !== updated.customerName) {
          changes.push(`Customer updated to ${updated.customerName}.`);
        }
        if (previous.assignedTo !== updated.assignedTo) {
          changes.push(
            `Owner updated to ${ownerNameMap.get(updated.assignedTo) ?? updated.assignedTo}.`,
          );
        }
        if (previous.status !== updated.status) {
          changes.push(`Status updated to ${formatStatusLabel(updated.status)}.`);
        }
        if (previous.value !== updated.value) {
          changes.push(`Value updated to AED ${updated.value.toLocaleString()}.`);
        }
        if (previous.startDate !== updated.startDate) {
          changes.push(`Start date updated to ${formatDate(updated.startDate)}.`);
        }
        if (previous.dueDate !== updated.dueDate) {
          changes.push(`Due date updated to ${formatDate(updated.dueDate)}.`);
        }
        if (previous.description?.trim() !== updated.description?.trim()) {
          changes.push('Description updated.');
        }
        if (changes.length > 0) {
          await logProjectActivity(updated.id, `Project updated: ${changes.join(' ')}`);
        }
      } else {
        const created = await firebaseProjectRepository.create({
          ...updates,
          createdBy: user.id,
        });
        clearProjectDraft(null);
        updateProjects((prev) => [created, ...prev]);
        await logProjectActivity(created.id, `Project created: ${created.name}.`);
        await emitNotificationEventSafe({
          type: 'project.assigned',
          title: 'New Project',
          body: `${user.fullName} created ${created.name}.`,
          actorId: user.id,
          recipients: buildRecipientList(created.assignedTo, [], user.id),
          entityType: 'project',
          entityId: created.id,
          requiredPermissionsAnyOf: getModuleNotificationPermissions('projects'),
          meta: {
            status: created.status,
          },
        });
      }
      handleCloseModal();
    } catch {
      setError('Unable to save project. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProject) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete projects.');
      return;
    }
    if (!canDelete) {
      setError('You do not have permission to delete projects.');
      return;
    }
    const confirmed = window.confirm(
      'Delete this project and all dependent records? This will cascade to linked tasks, quotations, sales order requests, project activities, and archived recovery data will be created before final deletion.',
    );
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/sales/projects/${selectedProject.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Unable to delete project.');
      }
      clearProjectDraft(selectedProject.id);
      clearProjectSalesOrderDraft(selectedProject.id);
      updateProjects((prev) => prev.filter((item) => item.id !== selectedProject.id));
      handleCloseModal();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to delete project. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleQuickStatusChange = async (project: Project, nextStatus: ProjectStatus) => {
    if (!user || !canEdit) {
      return;
    }
    if (!isAdmin && project.assignedTo !== user.id) {
      return;
    }
    try {
      const updated = await firebaseProjectRepository.update(project.id, {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      updateProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setError('Unable to update project status.');
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted/80 sm:text-xs sm:tracking-[0.28em]">
              Sales Projects
            </p>
            <h1 className="font-display text-5xl leading-tight text-text">Delivery runway</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Track project milestones and keep delivery details aligned with customer ownership.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center">
            {hasUserVisibility ? (
              <FilterDropdown
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={ownerOptions}
                ariaLabel="Project owner filter"
                className="col-span-1 w-full md:w-auto"
              />
            ) : null}
            <div className="relative col-span-1 grid w-full grid-cols-2 rounded-2xl border border-border bg-surface p-2 md:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-[var(--surface-soft)] shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out dark:bg-slate-50"
                style={{
                  width: 'calc((100% - 1rem) / 2)',
                  transform: viewMode === 'card' ? 'translateX(100%)' : 'translateX(0)',
                }}
              />
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                  viewMode === 'list' ? 'text-slate-900' : 'text-muted hover:text-text'
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('card')}
                className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                  viewMode === 'card' ? 'text-slate-900' : 'text-muted hover:text-text'
                }`}
              >
                Cards
              </button>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="col-span-2 w-full rounded-2xl border border-[#00B67A]/30 bg-[#00B67A] px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(0,182,122,0.22)] transition hover:-translate-y-[1px] hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              + New project
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Not started
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.notStarted}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              In progress
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.inProgress}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Hold on
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.onHold}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Completed
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.completed}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border bg-surface p-4 shadow-soft md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-2 text-xs text-muted md:w-auto md:min-w-[240px]">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                placeholder="Search projects"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 md:w-48"
              />
            </div>
            <div className="w-full md:hidden">
              <div className="relative w-full rounded-lg border border-border bg-[var(--surface-muted)] p-1">
                <div className="relative z-[1] grid grid-cols-2 gap-1">
                  {projectStatusFilterOptions.map((status) => (
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
                      {status === 'all' ? 'All' : formatStatusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative hidden rounded-2xl border border-border bg-[var(--surface-muted)] p-1 md:block md:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${projectStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedProjectStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${projectStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {projectStatusFilterOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                      statusFilter === status ? 'text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {status === 'all' ? 'All' : formatStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted">{filteredProjects.length} projects visible</div>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            You do not have permission to view projects.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            Loading projects...
          </div>
        ) : viewMode === 'card' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                role={canOpenDetails ? 'button' : undefined}
                tabIndex={canOpenDetails ? 0 : -1}
                onClick={() => handleEntryOpen(project)}
                onKeyDown={(event) => handleEntryKeyDown(event, project)}
                aria-disabled={!canOpenDetails}
                className={`rounded-3xl border border-border bg-surface p-4 shadow-soft ${
                  canOpenDetails
                    ? 'cursor-pointer transition hover:-translate-y-[1px] hover:border-border/80'
                    : ''
                }`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/80">
                      {project.customerName}
                    </p>
                    <h2 className="mt-1 font-display text-lg text-text">{project.name}</h2>
                    <div className="mt-1 space-y-1 text-[11px] text-muted">
                      <p>
                        Owner{' '}
                        <span className="font-semibold text-text">
                          {ownerNameMap.get(project.assignedTo) ?? project.assignedTo}
                        </span>
                      </p>
                      <p>Due {formatDate(project.dueDate)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                        statusStyles[project.status]
                      }`}
                    >
                      {formatStatusLabel(project.status)}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      AED {project.value.toLocaleString()}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      {formatDate(project.startDate)}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 grid w-full grid-cols-3 divide-x divide-border py-0.5 text-center">
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Value
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      AED {project.value.toLocaleString()}
                    </p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Owner
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      {(ownerNameMap.get(project.assignedTo) ?? project.assignedTo).split(' ')[0]}
                    </p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Status
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      {formatStatusLabel(project.status)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(project)}
                      className="rounded-xl bg-[#00B67A]/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#00B67A]"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                role={canOpenDetails ? 'button' : undefined}
                tabIndex={canOpenDetails ? 0 : -1}
                onClick={() => handleEntryOpen(project)}
                onKeyDown={(event) => handleEntryKeyDown(event, project)}
                aria-disabled={!canOpenDetails}
                className={`grid gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_1.2fr_1fr_0.95fr_1fr_0.9fr_auto] md:items-center md:gap-2 md:px-4 ${
                  canOpenDetails ? 'cursor-pointer' : ''
                } transition hover:bg-[var(--surface-soft)]`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-[var(--surface-muted)] text-[11px] font-semibold uppercase tracking-[0.12em] text-text">
                    {(ownerNameMap.get(project.assignedTo) ?? project.assignedTo)
                      .split(' ')
                      .map((word) => word[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-text">
                    {ownerNameMap.get(project.assignedTo) ?? project.assignedTo}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text">{project.name}</p>
                  <p className="truncate text-xs text-muted">{project.customerName}</p>
                </div>

                <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  {project.customerName}
                </p>

                <p className="text-sm text-text">{formatDate(project.dueDate)}</p>

                <div>
                  <select
                    value={project.status}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      handleQuickStatusChange(project, event.target.value as ProjectStatus)
                    }
                    disabled={!canEdit || (!isAdmin && project.assignedTo !== user?.id)}
                    className="w-full rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="inline-flex w-fit rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-text">
                  AED {project.value.toLocaleString()}
                </span>

                {canEdit ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenEdit(project);
                    }}
                    className="rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text"
                  >
                    Update
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {filteredProjects.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            No projects found yet.
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {isViewOpen && selectedProject ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseModal}
        >
          <DraggablePanel
            className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-surface/95 p-4 shadow-floating sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Project details
                </p>
                <h3 className="mt-2 font-display text-xl text-text sm:text-2xl">
                  {selectedProject.name}
                </h3>
                <p className="mt-2 text-xs text-muted sm:text-sm">
                  Review delivery details before editing.
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

            <div className="mt-5 inline-flex rounded-full border border-border/60 bg-bg/70 p-1">
              <button
                type="button"
                onClick={() => setProjectDetailsView('general')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition ${
                  projectDetailsView === 'general'
                    ? 'bg-surface/90 text-text'
                    : 'text-muted hover:bg-hover/80'
                }`}
              >
                General details
              </button>
              <button
                type="button"
                onClick={() => setProjectDetailsView('tasks')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition ${
                  projectDetailsView === 'tasks'
                    ? 'bg-surface/90 text-text'
                    : 'text-muted hover:bg-hover/80'
                }`}
              >
                Tasks
              </button>
            </div>

            <div className="mt-6 flex-1 min-h-0">
              {projectDetailsView === 'general' ? (
                <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[1.6fr_1fr]">
                  <div className="flex h-full min-h-0 flex-col gap-4">
                    <section
                      className="flex h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-bg/70 p-4 sm:p-6"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setIsTimelineExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between gap-3 text-left sm:cursor-default"
                      >
                        <p className="text-base font-semibold text-text sm:text-lg">Timeline</p>
                        <span className="rounded-full border border-border/60 bg-surface/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted sm:hidden">
                          {isTimelineExpanded ? 'Hide' : 'Show'}
                        </span>
                      </button>
                      <div
                        className={`${
                          isTimelineExpanded ? 'block' : 'hidden'
                        } mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto scroll-smooth pr-2 sm:mt-5 sm:block`}
                      >
                        {timelineLoading ? (
                          <p className="text-xs text-muted sm:text-sm">Loading activity...</p>
                        ) : timelineError ? (
                          <p className="text-xs text-rose-200 sm:text-sm">{timelineError}</p>
                        ) : timelineItems.length === 0 ? (
                          <p className="text-xs text-muted sm:text-sm">No activity logged yet.</p>
                        ) : (
                          timelineItems.map((activity, index) => {
                            const ownerLabel =
                              ownerNameMap.get(activity.createdBy) ??
                              activity.createdBy ??
                              'System';
                            return (
                              <div key={`${activity.id}-${index}`} className="flex gap-4">
                                <div className="flex flex-col items-center">
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${activityDotClass(activity)}`}
                                  />
                                  {index < timelineItems.length - 1 ? (
                                    <span className="mt-2 h-10 w-[1px] bg-border/60" />
                                  ) : null}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-text sm:text-base">
                                    {activity.note}
                                  </p>
                                  <p className="mt-1 text-xs text-muted sm:text-sm">
                                    {formatTimelineDate(activity.date)} - {ownerLabel}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {timelineHasMore ? (
                        <button
                          type="button"
                          onClick={handleLoadMoreTimeline}
                          disabled={timelineLoadingMore}
                          className={`${
                            isTimelineExpanded ? 'flex' : 'hidden'
                          } mt-4 w-full rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60 sm:flex`}
                        >
                          {timelineLoadingMore ? 'Loading...' : 'Load more'}
                        </button>
                      ) : null}
                    </section>
                  </div>

                  <div className="flex h-full min-h-0 flex-col space-y-4">
                    <div className="flex-1 min-h-0 rounded-2xl border border-border/60 bg-bg/70">
                      <button
                        type="button"
                        onClick={() => setIsDetailsExpanded((prev) => !prev)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                      >
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                            Details
                          </p>
                          <p className="mt-1 text-sm text-text">Project info</p>
                        </div>
                        <span className="rounded-full border border-border/60 bg-surface/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted sm:hidden">
                          {isDetailsExpanded ? 'Hide' : 'Show'}
                        </span>
                      </button>
                      <div
                        className={`${
                          isDetailsExpanded ? 'block' : 'hidden'
                        } max-h-full overflow-y-auto border-t border-border/60 px-4 py-4 sm:block`}
                      >
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Customer
                            </p>
                            <p className="mt-1 text-xs text-text sm:text-sm">
                              {selectedProject.customerName}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Owner
                            </p>
                            <p className="mt-1 text-xs text-text sm:text-sm">
                              {ownerNameMap.get(selectedProject.assignedTo) ??
                                selectedProject.assignedTo}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Status
                            </p>
                            <div className="mt-1">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                                  statusStyles[selectedProject.status]
                                }`}
                              >
                                {formatStatusLabel(selectedProject.status)}
                              </span>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Value
                            </p>
                            <p className="mt-1 text-xs text-text sm:text-sm">
                              AED {selectedProject.value.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Start date
                            </p>
                            <p className="mt-1 text-xs text-text sm:text-sm">
                              {formatDate(selectedProject.startDate)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                              Due date
                            </p>
                            <p className="mt-1 text-xs text-text sm:text-sm">
                              {formatDate(selectedProject.dueDate)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                            Description
                          </p>
                          <p className="mt-1 text-xs text-text sm:text-sm">
                            {selectedProject.description?.trim() || 'No description provided.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {canEdit && (isAdmin || selectedProject.assignedTo === user?.id) ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIsViewOpen(false);
                            handleOpenEdit(selectedProject);
                          }}
                          className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
                        >
                          Edit project
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border/60 bg-bg/70 p-4 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Tasks
                      </p>
                      <p className="mt-1 text-sm text-text">{projectTasks.length} linked tasks</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenTaskModal()}
                      disabled={!canCreateTasks}
                      className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Add task
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {taskTemplates.map((template) => (
                      <button
                        key={template.title}
                        type="button"
                        onClick={() => handleCreateFromTemplate(template)}
                        disabled={!canCreateTasks}
                        className="rounded-full border border-border/60 bg-surface/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {template.title}
                      </button>
                    ))}
                  </div>

                  {taskError ? (
                    <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                      {taskError}
                    </div>
                  ) : null}

                  <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {projectTasks.length === 0 ? (
                      <div className="rounded-2xl border border-border/60 bg-surface/70 px-4 py-3 text-sm text-muted">
                        No tasks linked to this project yet.
                      </div>
                    ) : (
                      projectTasks.map((task) => {
                        const assignees =
                          task.assignedUsers ?? (task.assignedTo ? [task.assignedTo] : []);
                        const isTaskAssignmentLocked = isAssignedTask(task);
                        const isEstimateTask = isEstimateProjectTask(task);
                        const canOpenSalesOrderFromEstimate =
                          isEstimateTask &&
                          task.status === 'done' &&
                          canRequestSalesOrder &&
                          (isAdmin || selectedProject.assignedTo === user?.id);
                        return (
                          <div
                            key={task.id}
                            className="rounded-2xl border border-border/60 bg-surface/70 px-4 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-text">{task.title}</p>
                                <p className="mt-1 text-xs text-muted">
                                  {formatAssigneeNames(assignees)}
                                </p>
                                {task.referenceModelNumber ? (
                                  <p className="mt-1 text-xs text-sky-200">
                                    Ref: {task.referenceModelNumber}
                                  </p>
                                ) : null}
                                {task.isRevision && task.revisionNumber ? (
                                  <p className="mt-1 text-xs text-amber-200">
                                    Revision: {task.revisionNumber}
                                  </p>
                                ) : null}
                                {isEstimateTask && task.estimateNumber ? (
                                  <p className="mt-1 text-xs text-emerald-200">
                                    Estimate No: {task.estimateNumber}
                                  </p>
                                ) : null}
                                {isEstimateTask &&
                                typeof task.estimateAmount === 'number' &&
                                Number.isFinite(task.estimateAmount) ? (
                                  <p className="mt-1 text-xs text-emerald-200">
                                    Estimate Amount: {task.estimateAmount.toLocaleString()}
                                  </p>
                                ) : null}
                                {task.dueDate ? (
                                  <p className="mt-1 text-xs text-muted">
                                    Due {formatDate(task.dueDate)}
                                  </p>
                                ) : (
                                  <p className="mt-1 text-xs text-muted">No due date</p>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                                    taskStatusPill[task.status]
                                  }`}
                                >
                                  {task.status.replace('-', ' ')}
                                </span>
                                <span
                                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                                    taskPriorityPill[task.priority]
                                  }`}
                                >
                                  {task.priority}
                                </span>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {canOpenSalesOrderFromEstimate ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSalesOrderModal(task)}
                                  className="rounded-full border border-border/60 bg-surface/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                                >
                                  Sales Order Req
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleOpenTaskModal(task)}
                                className="rounded-full border border-border/60 bg-surface/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenTaskModal(task)}
                                disabled={!canEditTasks}
                                className="rounded-full border border-border/60 bg-surface/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(task)}
                                disabled={!canEditTasks}
                                className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Delete
                              </button>
                              <div className="relative">
                                <select
                                  value={assignees[0] ?? ''}
                                  onChange={(event) => handleAssignTask(task, event.target.value)}
                                  disabled={
                                    !canEditTasks || !canAssignTasks || !canReassignProjectTasks
                                  }
                                  className="peer appearance-none rounded-2xl border border-border/60 bg-white px-4 py-2 pr-9 text-[11px] font-semibold uppercase tracking-[0.2em] text-black shadow-soft outline-none transition hover:bg-gray-50 focus:border-border/80 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <option value="">Unassigned</option>
                                  {assigneeOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                                <svg
                                  viewBox="0 0 20 20"
                                  className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-black/70"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M6 8l4 4 4-4" />
                                </svg>
                              </div>
                              <div className="relative">
                                <input
                                  type="date"
                                  value={task.dueDate ?? ''}
                                  onChange={(event) =>
                                    handleUpdateTaskDueDate(task, event.target.value)
                                  }
                                  disabled={!canEditTasks || isTaskAssignmentLocked}
                                  className="rounded-2xl border border-border/60 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-black shadow-soft outline-none transition hover:bg-gray-50 focus:border-border/80 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </DraggablePanel>
        </div>
      ) : null}

      {isTaskModalOpen && selectedProject ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={handleCloseTaskModal}
        >
          <DraggablePanel
            className="w-full max-w-2xl rounded-3xl border border-border/60 bg-surface/95 p-4 shadow-floating sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  {selectedTask ? 'Edit task' : 'Add task'}
                </p>
                <h3 className="mt-2 font-display text-xl text-text sm:text-2xl">Project task</h3>
                <p className="mt-2 text-xs text-muted sm:text-sm">
                  Track assignments, priority, and progress directly on the project.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseTaskModal}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSaveTask}>
              {selectedTask && isAssignedTask(selectedTask) ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
                  Due date and priority are locked once a task is assigned.
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Title
                  </label>
                  <input
                    required
                    value={taskFormState.title}
                    onChange={(event) =>
                      setTaskFormState((prev) => ({ ...prev, title: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="Install fixtures"
                  />
                  <div className="mt-3">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      <input
                        type="checkbox"
                        checked={taskFormState.isRevision}
                        onChange={(event) =>
                          setTaskFormState((prev) => ({
                            ...prev,
                            isRevision: event.target.checked,
                            revisionNumber: event.target.checked ? prev.revisionNumber : '',
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Mark as Revision
                    </label>
                    {taskFormState.isRevision ? (
                      <div className="mt-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                          Revision Number
                        </label>
                        <input
                          value={taskFormState.revisionNumber}
                          onChange={(event) =>
                            setTaskFormState((prev) => ({
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
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={taskFormState.dueDate}
                    onChange={(event) =>
                      setTaskFormState((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                    disabled={isAssignedTask(selectedTask)}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Assignees
                </label>
                <select
                  value={taskFormState.assignedUsers[0] ?? ''}
                  onChange={(event) =>
                    setTaskFormState((prev) => ({
                      ...prev,
                      assignedUsers: event.target.value ? [event.target.value] : [],
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-sm text-text outline-none"
                  disabled={
                    assigneeOptions.length === 0 ||
                    !canAssignTasks ||
                    (selectedTask !== null && !canReassignProjectTasks)
                  }
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.length === 0 ? (
                    <option value="" disabled>
                      No users available
                    </option>
                  ) : (
                    assigneeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Description
                </label>
                <textarea
                  value={taskFormState.description}
                  onChange={(event) =>
                    setTaskFormState((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="mt-2 min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <select
                    value={taskFormState.status}
                    onChange={(event) =>
                      setTaskFormState((prev) => ({
                        ...prev,
                        status: event.target.value as TaskStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    {taskStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Priority
                  </label>
                  <select
                    value={taskFormState.priority}
                    onChange={(event) =>
                      setTaskFormState((prev) => ({
                        ...prev,
                        priority: event.target.value as TaskPriority,
                      }))
                    }
                    disabled={isAssignedTask(selectedTask)}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                  >
                    {taskPriorityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Reference model number
                  </label>
                  <input
                    value={taskFormState.referenceModelNumber}
                    onChange={(event) =>
                      setTaskFormState((prev) => ({
                        ...prev,
                        referenceModelNumber: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="XYZ-123"
                  />
                </div>
              </div>

              {selectedTask &&
              isEstimateProjectTask(selectedTask) &&
              user &&
              ((taskFormState.assignedUsers[0] ?? '') === user.id ||
                taskFormState.assignedUsers.includes(user.id)) ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Estimate No
                    </label>
                    <input
                      value={taskFormState.estimateNumber}
                      onChange={(event) =>
                        setTaskFormState((prev) => ({
                          ...prev,
                          estimateNumber: event.target.value,
                        }))
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
                      value={taskFormState.estimateAmount}
                      onChange={(event) =>
                        setTaskFormState((prev) => ({
                          ...prev,
                          estimateAmount: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      placeholder="10000"
                    />
                  </div>
                </div>
              ) : null}

              {taskError ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                  {taskError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="submit"
                  disabled={isTaskSaving}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTaskSaving ? 'Saving...' : selectedTask ? 'Save task' : 'Create task'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}

      {isSalesOrderModalOpen && selectedProject ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={() => {
            setIsSalesOrderModalOpen(false);
            setSalesOrderError(null);
          }}
        >
          <DraggablePanel
            className="w-full max-w-3xl rounded-3xl border border-border/60 bg-surface/95 p-4 shadow-floating sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Sales Order Req
                </p>
                <h3 className="mt-2 font-display text-xl text-text sm:text-2xl">
                  Request for {selectedProject.name}
                </h3>
                <p className="mt-2 text-xs text-muted sm:text-sm">
                  Submit estimate and Sales Order details for approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSalesOrderModalOpen(false);
                  setSalesOrderError(null);
                }}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmitSalesOrderRequest}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Estimate number
                  </label>
                  <input
                    required
                    value={salesOrderFormState.estimateNumber}
                    onChange={(event) =>
                      setSalesOrderFormState((prev) => ({
                        ...prev,
                        estimateNumber: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="EST-2026-001"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Estimate amount
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={salesOrderFormState.estimateAmount}
                    onChange={(event) =>
                      setSalesOrderFormState((prev) => ({
                        ...prev,
                        estimateAmount: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="15000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Sales Order number
                  </label>
                  <input
                    required
                    value={salesOrderFormState.salesOrderNumber}
                    onChange={(event) =>
                      setSalesOrderFormState((prev) => ({
                        ...prev,
                        salesOrderNumber: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="SOR-2026-015"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Sales Order amount
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={salesOrderFormState.salesOrderAmount}
                    onChange={(event) =>
                      setSalesOrderFormState((prev) => ({
                        ...prev,
                        salesOrderAmount: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="17500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Sales Order date
                </label>
                <input
                  type="date"
                  required
                  value={salesOrderFormState.salesOrderDate}
                  onChange={(event) =>
                    setSalesOrderFormState((prev) => ({
                      ...prev,
                      salesOrderDate: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
              </div>

              {salesOrderError ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                  {salesOrderError}
                </div>
              ) : null}
              {salesOrderSuccess ? (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                  {salesOrderSuccess}
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSalesOrderSubmitting}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSalesOrderSubmitting ? 'Submitting...' : 'Submit for approval'}
                </button>
              </div>
            </form>
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
            className="w-full max-w-3xl rounded-3xl border border-border/60 bg-surface/95 p-4 shadow-floating md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  {selectedProject ? 'Edit project' : 'Create project'}
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Project details</h3>
                <p className="mt-2 text-sm text-muted">
                  Tie the project to a customer and follow delivery status.
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

            <form className="mt-6 space-y-4" onSubmit={handleSave}>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Project name
                  </label>
                  <input
                    required
                    value={formState.name}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Customer
                  </label>
                  <select
                    value={formState.customerId}
                    onChange={(event) => handleSelectCustomer(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    <option value="">Select customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.companyName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={formState.startDate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, startDate: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={formState.dueDate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, dueDate: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Value
                  </label>
                  <input
                    type="number"
                    value={formState.value}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, value: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: event.target.value as ProjectStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Owner
                  </label>
                  <input
                    value={ownerNameMap.get(formState.assignedTo) ?? formState.assignedTo}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted"
                    readOnly
                  />
                </div>
              </div>

              <div>
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

              <div className="flex flex-wrap items-center justify-end gap-3">
                {selectedProject && canDelete ? (
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
                  {isSaving ? 'Saving...' : selectedProject ? 'Save changes' : 'Create project'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      )}
    </div>
  );
}
