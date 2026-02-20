'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Customer } from '@/core/entities/customer';
import { Project, ProjectStatus } from '@/core/entities/project';
import { Task, TaskPriority, TaskStatus } from '@/core/entities/task';
import { User } from '@/core/entities/user';
import { getFirebaseAuth, getFirebaseDb } from '@/frameworks/firebase/client';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import {
  areSameRecipientSets,
  buildRecipientList,
  emitNotificationEventSafe,
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
  'in-progress': 'bg-accent/70 text-text',
  'on-hold': 'bg-amber-500/20 text-amber-200',
  completed: 'bg-emerald-200 text-emerald-900',
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

const buildAssignedRecipients = (assignedUsers: string[] | undefined, actorId: string) =>
  buildRecipientList('', assignedUsers ?? [], actorId);

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
};

type PoRequestFormState = {
  estimateNumber: string;
  estimateAmount: string;
  poNumber: string;
  poAmount: string;
  poDate: string;
};

type ProjectActivity = {
  id: string;
  note: string;
  date: string;
  createdBy: string;
  type?: string;
};

const TIMELINE_PAGE_SIZE = 12;

const todayKey = () => new Date().toISOString().slice(0, 10);
const emptyPoForm = (): PoRequestFormState => ({
  estimateNumber: '',
  estimateAmount: '',
  poNumber: '',
  poAmount: '',
  poDate: todayKey(),
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [loading, setLoading] = useState(true);
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
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [isPoSubmitting, setIsPoSubmitting] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [poSuccess, setPoSuccess] = useState<string | null>(null);
  const [poFormState, setPoFormState] = useState<PoRequestFormState>(() => emptyPoForm());

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'project_view']);
  const canViewAllProjects =
    !!user && hasPermission(user.permissions, ['admin', 'project_view_all']);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'project_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'project_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'project_delete']);
  const canOpenDetails = canView;
  const canCreateTasks = !!user && hasPermission(user.permissions, ['admin', 'task_create']);
  const canEditTasks = !!user && hasPermission(user.permissions, ['admin', 'task_edit']);
  const canAssignTasks = !!user && hasPermission(user.permissions, ['admin', 'task_assign']);
  const canReassignProjectTasks = isAdmin;
  const canRequestPo = !!user &&
    hasPermission(user.permissions, [
      'admin',
      'sales_order_request_create',
      'po_request_create',
    ]);
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
  });

  const [taskFormState, setTaskFormState] = useState<ProjectTaskFormState>(() => emptyTask());

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

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllProjects) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [canViewAllProjects, user, users]);

  const assigneeOptions = useMemo(() => {
    if (!canAssignTasks) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return filterAssignableUsers(users, roles, 'task_assign').map((entry) => ({
      id: entry.id,
      name: entry.fullName,
    }));
  }, [user, users, roles, canAssignTasks]);

  const timelineItems = useMemo(
    () => [...timelineBaseItems, ...timelineExtraItems],
    [timelineBaseItems, timelineExtraItems],
  );

  useEffect(() => {
    if (!user || !(canViewAllProjects || canAssignTasks)) {
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
  }, [user, canViewAllProjects, canAssignTasks]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!canViewAllProjects) {
      setOwnerFilter(user.id);
    }
  }, [user, canViewAllProjects]);

  useEffect(() => {
    const loadCustomers = async () => {
      if (!user) {
        setCustomers([]);
        return;
      }
      try {
        if (canViewAllCustomers || isAdmin) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          setCustomers(allCustomers);
          return;
        }
        const result = await firebaseCustomerRepository.listForUser(user.id, user.role);
        setCustomers(result);
      } catch {
        setCustomers([]);
      }
    };
    loadCustomers();
  }, [user, isAdmin, canViewAllCustomers]);

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
      setLoading(true);
      setError(null);
      try {
        if (canViewAllProjects) {
          const allProjects = await firebaseProjectRepository.listAll();
          if (ownerFilter === 'all') {
            setProjects(allProjects);
            return;
          }
          const selectedRole = userRoleMap.get(ownerFilter);
          const filtered = allProjects.filter(
            (project) =>
              project.assignedTo === ownerFilter ||
              (selectedRole ? project.sharedRoles.includes(selectedRole) : false),
          );
          setProjects(filtered);
          return;
        }
        const result = await firebaseProjectRepository.listForUser(user.id, user.role);
        setProjects(result);
      } catch {
        setError('Unable to load projects. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadProjects();
  }, [user, canView, canViewAllProjects, ownerFilter, userRoleMap]);

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

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedProject(null);
    setFormState(emptyProject(user.id));
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (project: Project) => {
    setSelectedProject(project);
    setFormState({
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
    setIsPoModalOpen(false);
    setSelectedTask(null);
    setPoError(null);
    setPoSuccess(null);
  };

  const handleOpenPoModal = () => {
    if (!selectedProject || !canRequestPo) {
      return;
    }
    setPoFormState(emptyPoForm());
    setPoError(null);
    setPoSuccess(null);
    setIsPoModalOpen(true);
  };

  const handleSubmitPoRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !selectedProject || !canRequestPo) {
      return;
    }
    const estimateNumber = poFormState.estimateNumber.trim();
    const poNumber = poFormState.poNumber.trim();
    const poDate = poFormState.poDate.trim();
    const estimateAmount = Number(poFormState.estimateAmount);
    const poAmount = Number(poFormState.poAmount);

    if (!estimateNumber) {
      setPoError('Estimate number is required.');
      return;
    }
    if (!Number.isFinite(estimateAmount) || estimateAmount <= 0) {
      setPoError('Estimate amount must be greater than 0.');
      return;
    }
    if (!poNumber) {
      setPoError('PO number is required.');
      return;
    }
    if (!Number.isFinite(poAmount) || poAmount <= 0) {
      setPoError('PO amount must be greater than 0.');
      return;
    }
    if (!poDate) {
      setPoError('Date of the PO is required.');
      return;
    }

    setIsPoSubmitting(true);
    setPoError(null);
    setPoSuccess(null);
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setPoError('You must be signed in to submit Sales Order Reqs.');
        return;
      }
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/sales-order/sales-order-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          estimateNumber,
          estimateAmount,
          poNumber,
          poAmount,
          poDate,
        }),
      });
      const data = (await response.json()) as { error?: string; requestNo?: string };
      if (!response.ok) {
        setPoError(data.error ?? 'Unable to submit Sales Order Req.');
        return;
      }

      const requestNo = data.requestNo ?? 'Sales Order Req';
      setPoSuccess(`${requestNo} submitted for approval.`);
      setPoFormState(emptyPoForm());
    } catch {
      setPoError('Unable to submit Sales Order Req. Please try again.');
    } finally {
      setIsPoSubmitting(false);
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
      !!task &&
      !!user &&
      (task.assignedTo === user.id || taskAssignees.includes(user.id));
    if (task && !canEditTasks && !canEditEstimateOnly) {
      return;
    }
    if (!task && !canCreateTasks) {
      return;
    }
    setTaskError(null);
    if (task) {
      setSelectedTask(task);
      setTaskFormState({
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
      });
    } else {
      setSelectedTask(null);
      setTaskFormState(emptyTask());
    }
    setIsTaskModalOpen(true);
  };

  const handleCloseTaskModal = () => {
    setIsTaskModalOpen(false);
  };

  const handleSaveTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !selectedProject) {
      return;
    }
    const selectedTaskAssignees =
      selectedTask?.assignedUsers ?? (selectedTask?.assignedTo ? [selectedTask.assignedTo] : []);
    const canEditEstimateOnly =
      !!selectedTask &&
      !!user &&
      (selectedTask.assignedTo === user.id || selectedTaskAssignees.includes(user.id));
    if (selectedTask && !canEditTasks && !canEditEstimateOnly) {
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
      const previousAssignees =
        selectedTask.assignedUsers ?? (selectedTask.assignedTo ? [selectedTask.assignedTo] : []);
      const assignmentChanged =
        selectedTask.assignedTo !== assignedTo ||
        !areSameRecipientSets(previousAssignees, assignedUsers);
      if (assignmentChanged) {
        setTaskError('Only admins can reassign tasks after assignment.');
        setIsTaskSaving(false);
        return;
      }
    }
    const canEditEstimateDetails =
      !!user && (assignedTo === user.id || assignedUsers.includes(user.id));
    const estimateNumber = taskFormState.estimateNumber.trim();
    const estimateAmountRaw = taskFormState.estimateAmount.trim();
    const estimateAmount = estimateAmountRaw.length > 0 ? Number(estimateAmountRaw) : null;
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
        if (!canEditTasks && canEditEstimateOnly) {
          const updated = await firebaseTaskRepository.update(selectedTask.id, {
            ...estimatePayload,
            updatedAt: new Date().toISOString(),
          });
          setProjectTasks((prev) => prev.map((item) => (item.id === selectedTask.id ? updated : item)));
          await logProjectActivity(selectedProject.id, `Estimate details updated for task: ${updated.title}.`, 'task');
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
          priority: taskFormState.priority,
          dueDate: taskFormState.dueDate,
          referenceModelNumber: taskFormState.referenceModelNumber.trim(),
          ...estimatePayload,
          isEstimateTemplateTask: estimateFlag,
          updatedAt: new Date().toISOString(),
        });
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
          ...estimatePayload,
          sharedRoles: [],
          createdBy: user.id,
        });
        const recipients = buildAssignedRecipients(assignedUsers, user.id);
        await emitNotificationEventSafe({
          type: 'task.assigned',
          title: 'New Task',
          body: `${user.fullName} assigned: ${created.title}.`,
          actorId: user.id,
          recipients,
          entityType: 'task',
          entityId: created.id,
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
    if (!isAdmin) {
      setTaskError('Only admins can reassign tasks after assignment.');
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
        setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        if (previous.assignedTo !== updated.assignedTo) {
          await emitNotificationEventSafe({
            type: 'project.assigned',
            title: 'Project Assigned',
            body: `${user.fullName} assigned you to ${updated.name}.`,
            actorId: user.id,
            recipients: buildRecipientList(updated.assignedTo, [], user.id),
            entityType: 'project',
            entityId: updated.id,
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
        setProjects((prev) => [created, ...prev]);
        await logProjectActivity(created.id, `Project created: ${created.name}.`);
        await emitNotificationEventSafe({
          type: 'project.assigned',
          title: 'New Project',
          body: `${user.fullName} created ${created.name}.`,
          actorId: user.id,
          recipients: buildRecipientList(created.assignedTo, [], user.id),
          entityType: 'project',
          entityId: created.id,
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
    if (!isAdmin && selectedProject.assignedTo !== user.id) {
      setError('You can only delete projects assigned to you.');
      return;
    }
    const confirmed = window.confirm('Delete this project? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseProjectRepository.delete(selectedProject.id);
      setProjects((prev) => prev.filter((item) => item.id !== selectedProject.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete project. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-4 shadow-soft md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted sm:text-xs sm:tracking-[0.28em]">
              Sales Projects
            </p>
            <h1 className="font-display text-2xl leading-tight text-text sm:text-3xl">
              Delivery runway
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">
              Track project milestones and keep delivery details aligned with customer ownership.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center">
            <div className="col-span-1 flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted md:w-auto">
              <label htmlFor="project-owner" className="sr-only">
                Owner
              </label>
              <select
                id="project-owner"
                name="project-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllProjects}
                className="bg-transparent text-[11px] font-semibold uppercase tracking-[0.18em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70 sm:text-xs sm:tracking-[0.2em]"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-1 flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted md:w-auto">
              <label htmlFor="project-view" className="sr-only">
                View
              </label>
              <select
                id="project-view"
                name="project-view"
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as 'list' | 'card')}
                className="bg-transparent text-[11px] font-semibold uppercase tracking-[0.18em] text-text outline-none sm:text-xs sm:tracking-[0.2em]"
              >
                <option value="list">List</option>
                <option value="card">Card</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="col-span-2 w-full rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              New project
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs sm:tracking-[0.26em]">
              Not started
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.notStarted}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs sm:tracking-[0.26em]">
              In progress
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.inProgress}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs sm:tracking-[0.26em]">
              Hold on
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.onHold}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted sm:text-xs sm:tracking-[0.26em]">
              Completed
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.completed}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-4 shadow-soft md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-full border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted md:w-auto">
              <input
                type="search"
                placeholder="Search projects"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 md:w-48"
              />
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-bg/70 p-2 md:w-auto md:flex md:flex-wrap md:items-center md:rounded-full md:p-1">
              {(['all', ...statusOptions.map((status) => status.value)] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`w-full shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition md:w-auto md:rounded-full ${
                    statusFilter === status
                      ? 'bg-accent/80 text-text'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {status === 'all' ? 'All' : formatStatusLabel(status)}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted">{filteredProjects.length} projects visible</div>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            You do not have permission to view projects.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            Loading projects...
          </div>
        ) : viewMode === 'card' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                role={canOpenDetails ? 'button' : undefined}
                tabIndex={canOpenDetails ? 0 : -1}
                onClick={() => handleEntryOpen(project)}
                onKeyDown={(event) => handleEntryKeyDown(event, project)}
                aria-disabled={!canOpenDetails}
                className={`lift-hover rounded-2xl border border-border/60 bg-bg/70 p-4 ${
                  canOpenDetails ? 'cursor-pointer' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      {project.customerName}
                    </p>
                    <h2 className="mt-2 font-display text-xl text-text sm:text-2xl">
                      {project.name}
                    </h2>
                    <p className="mt-2 text-sm text-muted">
                      Owner: {ownerNameMap.get(project.assignedTo) ?? project.assignedTo}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      statusStyles[project.status]
                    }`}
                  >
                    {formatStatusLabel(project.status)}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-muted md:grid-cols-3 md:text-sm">
                  <div className="rounded-xl border border-border/60 bg-surface/70 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Start
                    </p>
                    <p className="mt-1 text-sm text-text">{formatDate(project.startDate)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-surface/70 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Due
                    </p>
                    <p className="mt-1 text-sm text-text">{formatDate(project.dueDate)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-surface/70 px-3 py-2 md:col-span-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      Value
                    </p>
                    <p className="mt-1 text-sm text-text">AED {project.value.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(project)}
                      className="w-full rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-hover/80 md:w-auto"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {filteredProjects.map((project, index) => (
              <button
                key={project.id}
                type="button"
                onClick={() => handleEntryOpen(project)}
                onKeyDown={(event) => handleEntryKeyDown(event, project)}
                aria-disabled={!canOpenDetails}
                className={`lift-hover group relative rounded-2xl border border-border/60 bg-bg/70 p-4 text-left transition ${
                  canOpenDetails ? 'cursor-pointer' : ''
                } md:grid md:grid-cols-[2fr_1fr_1fr] md:items-start md:gap-3`}
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    {project.customerName}
                  </p>
                  <h3 className="mt-2 font-display text-xl text-text">{project.name}</h3>
                </div>
                <div className="mt-4 flex flex-col gap-2 md:mt-0">
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                      statusStyles[project.status]
                    }`}
                  >
                    {formatStatusLabel(project.status)}
                  </span>
                  <p className="text-sm font-semibold text-text">
                    AED {project.value.toLocaleString()}
                  </p>
                </div>
                <div className="mt-4 text-sm text-muted md:mt-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                    Owner
                  </p>
                  <p className="mt-1 text-sm text-text">
                    {ownerNameMap.get(project.assignedTo) ?? project.assignedTo}
                  </p>
                </div>
              </button>
            ))}
            {filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
                No projects found yet.
              </div>
            ) : null}
          </div>
        )}
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
                        const isEstimateTask =
                          task.isEstimateTemplateTask === true ||
                          task.title.trim().toLowerCase() === 'estimate';
                        const canOpenPoFromEstimate =
                          isEstimateTask &&
                          canRequestPo &&
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
                                {task.estimateNumber ? (
                                  <p className="mt-1 text-xs text-emerald-200">
                                    Estimate No: {task.estimateNumber}
                                  </p>
                                ) : null}
                                {typeof task.estimateAmount === 'number' &&
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
                              {canOpenPoFromEstimate ? (
                                <button
                                  type="button"
                                  onClick={handleOpenPoModal}
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
                                  disabled={!canEditTasks || !canAssignTasks || !canReassignProjectTasks}
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
                                  disabled={!canEditTasks}
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
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
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
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
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

              {user &&
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

      {isPoModalOpen && selectedProject ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={() => {
            setIsPoModalOpen(false);
            setPoError(null);
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
                  Submit estimate and PO details to Sales Order for approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPoModalOpen(false);
                  setPoError(null);
                }}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmitPoRequest}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Estimate number
                  </label>
                  <input
                    required
                    value={poFormState.estimateNumber}
                    onChange={(event) =>
                      setPoFormState((prev) => ({ ...prev, estimateNumber: event.target.value }))
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
                    value={poFormState.estimateAmount}
                    onChange={(event) =>
                      setPoFormState((prev) => ({ ...prev, estimateAmount: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="15000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    PO number
                  </label>
                  <input
                    required
                    value={poFormState.poNumber}
                    onChange={(event) =>
                      setPoFormState((prev) => ({ ...prev, poNumber: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="PO-2026-015"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    PO amount
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={poFormState.poAmount}
                    onChange={(event) =>
                      setPoFormState((prev) => ({ ...prev, poAmount: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="17500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Date of the PO
                </label>
                <input
                  type="date"
                  required
                  value={poFormState.poDate}
                  onChange={(event) =>
                    setPoFormState((prev) => ({ ...prev, poDate: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
              </div>

              {poError ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                  {poError}
                </div>
              ) : null}
              {poSuccess ? (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                  {poSuccess}
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isPoSubmitting}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPoSubmitting ? 'Submitting...' : 'Submit for approval'}
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
