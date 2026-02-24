'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc } from 'firebase/firestore';

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
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import {
  areSameRecipientSets,
  buildRecipientList,
  emitNotificationEventSafe,
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
  low: 'bg-[var(--surface-muted)] text-muted border border-border',
  medium: 'bg-orange-50 text-orange-600 border border-orange-200',
  high: 'bg-rose-50 text-rose-600 border border-rose-200',
  urgent: 'bg-red-100 text-red-700 border border-red-200',
};

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

const buildAssignedRecipients = (
  assignedTo: string,
  assignedUsers: string[] | undefined,
  actorId: string,
) => buildRecipientList(assignedTo, assignedUsers ?? [], actorId);

export default function Page() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectNameOverrides, setProjectNameOverrides] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [timerTick, setTimerTick] = useState(() => Date.now());
  const [timerBusyId, setTimerBusyId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'task_view']);
  const canViewAllTasks = !!user && hasPermission(user.permissions, ['admin', 'task_view_all']);
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

  const [formState, setFormState] = useState<TaskFormState>(() => emptyTask(''));

  const canEditEstimateDetails =
    !!user && (formState.assignedTo === user.id || formState.assignedUsers.includes(user.id));

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

  const getSessionDuration = (task: Task) => {
    if (!task.timerStartedAt) {
      return 0;
    }
    const startedMs = Date.parse(task.timerStartedAt);
    if (Number.isNaN(startedMs)) {
      return 0;
    }
    return Math.max(0, Math.floor((timerTick - startedMs) / 1000));
  };

  const canTrackTask = (task: Task) => {
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

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllTasks) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [canViewAllTasks, user, users]);

  const assignableUsers = useMemo(() => {
    return filterAssignableUsers(users, roles, 'task_assign');
  }, [users, roles]);

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => map.set(project.id, project.name));
    return map;
  }, [projects]);

  const taskProjectNameMap = useMemo(() => {
    const map = new Map(projectNameMap);
    Object.entries(projectNameOverrides).forEach(([id, name]) => {
      if (!map.has(id)) {
        map.set(id, name);
      }
    });
    return map;
  }, [projectNameMap, projectNameOverrides]);

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

  useEffect(() => {
    if (!user || !(canViewAllTasks || canAssign)) {
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
  }, [user, canViewAllTasks, canAssign]);

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
    if (!canViewAllTasks) {
      setOwnerFilter(user.id);
    }
  }, [user, canViewAllTasks]);

  useEffect(() => {
    const loadTasks = async () => {
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
      setLoading(true);
      setError(null);
      try {
        if (canViewAllTasks) {
          const allTasks = await firebaseTaskRepository.listAll();
          if (ownerFilter === 'all') {
            setTasks(allTasks.map((task) => ({ ...task, status: normalizeStatus(task.status) })));
            return;
          }
          const filtered = allTasks.filter((task) => {
            const matchesOwner =
              task.assignedTo === ownerFilter || (task.assignedUsers ?? []).includes(ownerFilter);
            return matchesOwner;
          });
          setTasks(filtered.map((task) => ({ ...task, status: normalizeStatus(task.status) })));
          return;
        }
        const result = await firebaseTaskRepository.listForUser(user.id, user.role);
        setTasks(result.map((task) => ({ ...task, status: normalizeStatus(task.status) })));
      } catch {
        setError('Unable to load tasks. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadTasks();
  }, [user, canView, canViewAllTasks, ownerFilter]);

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
          if (!projectId || projectNameMap.has(projectId) || projectNameOverrides[projectId]) {
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
          const data = snap.data() as { name?: unknown };
          const name = typeof data.name === 'string' && data.name.trim().length > 0 ? data.name : null;
          if (!name) {
            return null;
          }
          return { projectId, name } as const;
        }),
      );
      if (!active) {
        return;
      }
      const updates: Record<string, string> = {};
      resolved.forEach((item) => {
        if (item) {
          updates[item.projectId] = item.name;
        }
      });
      if (Object.keys(updates).length > 0) {
        setProjectNameOverrides((prev) => ({ ...prev, ...updates }));
      }
    };
    loadMissingNames();
    return () => {
      active = false;
    };
  }, [tasks, projectNameMap, projectNameOverrides]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === 'all' ? true : task.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [task.title, task.description].some((value) => value.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [tasks, search, statusFilter]);

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

  const renderBoardTaskCard = (
    task: Task,
    variant: 'list' | 'cards' | 'kanban' = 'list',
  ) => {
    const isRunning = !!task.timerStartedAt;
    const sessionSeconds = getSessionDuration(task);
    const totalSeconds = getLiveDuration(task);
    const canTrack = canTrackTask(task);
    const showDetails = variant !== 'kanban';
    const cardClass =
      variant === 'list'
        ? 'rounded-none border-b border-border bg-surface p-6 last:border-b-0'
        : variant === 'cards'
          ? 'rounded-3xl border border-border bg-surface p-4 shadow-[0_6px_18px_rgba(15,23,42,0.05)]'
          : 'rounded-3xl border border-border bg-surface p-5 shadow-[0_4px_16px_rgba(15,23,42,0.06)]';

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
        className={`${cardClass} cursor-pointer transition hover:-translate-y-[1px]`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
              {task.assignedTo ? (ownerNameMap.get(task.assignedTo) ?? task.assignedTo) : 'Unassigned'}
            </p>
            <p
              className={`mt-2 font-semibold text-text ${
                variant === 'cards' ? 'text-sm' : variant === 'kanban' ? 'text-3xl' : 'text-3xl sm:text-4xl'
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
            ? `Project: ${taskProjectNameMap.get(task.projectId) ?? task.projectId}`
            : task.leadReference
              ? `Lead: ${task.leadReference}`
              : 'No linked record'}
        </div>

        {showDetails ? (
          <div className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <p>Due {formatDate(task.dueDate)}</p>
            <p className="sm:text-right">Total {formatDuration(totalSeconds)}</p>
            {isRunning ? (
              <p className="sm:col-span-2 text-emerald-700">Running {formatDuration(sessionSeconds)}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={task.status}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => handleQuickStatusChange(task, event.target.value as TaskStatus)}
            disabled={!canTrack || statusBusyId === task.id}
            className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {isRunning ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleStopTaskTimer(task);
              }}
              disabled={!canTrack || timerBusyId === task.id}
              className="rounded-full border border-emerald-600 bg-emerald-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {timerBusyId === task.id ? 'Stopping...' : 'Running'}
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleStartTaskTimer(task);
              }}
              disabled={!canTrack || timerBusyId === task.id}
              className="rounded-full border border-emerald-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {timerBusyId === task.id ? 'Starting...' : variant === 'kanban' ? 'Timer' : 'Start timer'}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenEdit(task);
            }}
            className="rounded-full border border-border bg-[var(--surface-soft)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-text"
          >
            Update
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
    setIsAdvancedOpen(false);
    setFormState(emptyTask(''));
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (task: Task) => {
    setSelectedTask(task);
    setIsAdvancedOpen(false);
    setFormState({
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
    setIsEditOpen(true);
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
    setIsAdvancedOpen(false);
  };

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
    if (isEditing && !canEdit) {
      setError('You do not have permission to edit tasks.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create tasks.');
      return;
    }
    if (isEditing && !isAdmin && selectedTask?.assignedTo !== user.id) {
      setError('You can only edit tasks assigned to you.');
      return;
    }
    if (isEditing && selectedTask && !isAdmin) {
      const previousAssignedUsers =
        selectedTask.assignedUsers ?? (selectedTask.assignedTo ? [selectedTask.assignedTo] : []);
      const assignmentChanged =
        selectedTask.assignedTo !== formState.assignedTo ||
        !areSameRecipientSets(previousAssignedUsers, formState.assignedUsers);
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
      if ((estimateNumber.length > 0 && estimateAmountRaw.length === 0) || (estimateNumber.length === 0 && estimateAmountRaw.length > 0)) {
        setError('Provide both Estimate No and Estimate Amount.');
        return;
      }
      if (estimateAmountRaw.length > 0 && (!Number.isFinite(estimateAmount) || estimateAmount === null || estimateAmount <= 0)) {
        setError('Estimate amount must be greater than 0.');
        return;
      }
    }
    setIsSaving(true);
    setError(null);
    try {
      const basePayload = {
        title: formState.title.trim(),
        description: formState.description.trim(),
        assignedTo: formState.assignedTo,
        assignedUsers: formState.assignedUsers,
        status: formState.status,
        priority: formState.priority,
        recurrence: formState.recurrence,
        quotationNumber: formState.quotationNumber,
        startDate: formState.startDate,
        endDate: formState.status === 'done' ? todayKey() : formState.endDate,
        dueDate: formState.dueDate,
        parentTaskId: formState.parentTaskId,
        projectId: formState.projectId,
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
        if (
          previousStatus !== 'done' &&
          updated.status === 'done' &&
          updated.quotationRequestId &&
          updated.quotationRequestTaskId &&
          updated.leadId &&
          updated.rfqTag
        ) {
          const completedAt = new Date().toISOString();
          await firebaseQuotationRequestRepository.updateTask(
            updated.quotationRequestId,
            updated.quotationRequestTaskId,
            { status: 'done', updatedAt: completedAt },
          );
          await firebaseLeadRepository.addActivity(updated.leadId, {
            type: 'note',
            note: `RFQ task completed: ${updated.rfqTag}.`,
            date: completedAt,
            createdBy: user.id,
          });
        }
        setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      } else {
        const created = await firebaseTaskRepository.create({
          ...basePayload,
          ...estimatePayload,
          sharedRoles: [],
          createdBy: user.id,
        });
        setTasks((prev) => [created, ...prev]);
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
    if (task.timerStartedAt) {
      return;
    }
    setTimerBusyId(task.id);
    setError(null);
    try {
      const startedAt = new Date().toISOString();
      const startedDate = todayKey();
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: startedAt,
        startDate: startedDate,
        status: task.status === 'todo' ? 'in-progress' : task.status,
        updatedAt: startedAt,
      });
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      const recipients = buildRecipientList(
        updated.createdBy,
        [updated.assignedTo, ...(updated.assignedUsers ?? [])],
        user.id,
      );
      await emitNotificationEventSafe({
        type: 'task.timer_started',
        title: 'Task Timer Started',
        body: `${user.fullName} started the timer for ${updated.title}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        meta: {
          timerStartedAt: startedAt,
        },
      });
      if (task.projectId) {
        await logProjectActivity(task.projectId, `Task started: ${task.title}.`);
      }
      if (task.leadId) {
        await logLeadActivity(task.leadId, `Task started: ${task.title}.`);
      }
    } catch {
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
    const startedMs = Date.parse(task.timerStartedAt);
    if (Number.isNaN(startedMs)) {
      setError('Unable to read the timer start time.');
      return;
    }
    setTimerBusyId(task.id);
    setError(null);
    try {
      const stoppedAt = new Date().toISOString();
      const stoppedDate = todayKey();
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      const totalSeconds = (task.totalTrackedSeconds ?? 0) + durationSeconds;
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: '',
        lastTimerStoppedAt: stoppedAt,
        lastTimerDurationSeconds: durationSeconds,
        totalTrackedSeconds: totalSeconds,
        endDate: stoppedDate,
        updatedAt: stoppedAt,
      });
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      const recipients = buildRecipientList(
        updated.createdBy,
        [updated.assignedTo, ...(updated.assignedUsers ?? [])],
        user.id,
      );
      await emitNotificationEventSafe({
        type: 'task.timer_stopped',
        title: 'Task Timer Stopped',
        body: `${user.fullName} stopped the timer for ${updated.title}.`,
        actorId: user.id,
        recipients,
        entityType: 'task',
        entityId: updated.id,
        meta: {
          durationSeconds,
          totalSeconds,
        },
      });
      const note = `Task timer stopped: ${task.title}. Duration ${formatDuration(
        durationSeconds,
      )}. Total ${formatDuration(totalSeconds)}.`;
      if (task.projectId) {
        await logProjectActivity(task.projectId, note);
      }
      if (task.leadId) {
        await logLeadActivity(task.leadId, note);
      }
    } catch {
      setError('Unable to stop timer. Please try again.');
    } finally {
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
    if (nextStatus === task.status) {
      return;
    }
    setStatusBusyId(task.id);
    setError(null);
    try {
      const updatedAt = new Date().toISOString();
      const updated = await firebaseTaskRepository.update(task.id, {
        status: nextStatus,
        endDate: nextStatus === 'done' ? todayKey() : task.endDate,
        updatedAt,
      });
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
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
        updated.quotationRequestTaskId &&
        updated.leadId &&
        updated.rfqTag
      ) {
        await firebaseQuotationRequestRepository.updateTask(
          updated.quotationRequestId,
          updated.quotationRequestTaskId,
          { status: 'done', updatedAt },
        );
        await firebaseLeadRepository.addActivity(updated.leadId, {
          type: 'note',
          note: `RFQ task completed: ${updated.rfqTag}.`,
          date: updatedAt,
          createdBy: user.id,
        });
      }
    } catch {
      setError('Unable to update task status. Please try again.');
    } finally {
      setStatusBusyId(null);
    }
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
      setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete task. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="p-2 sm:p-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">Tasks</p>
            <h1 className="mt-2 font-display text-5xl font-semibold text-text">Team task board</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Track tasks across modules with role-based shared visibility and due-date focus.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:w-auto">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-muted">
              <label htmlFor="task-owner" className="sr-only">
                Owner
              </label>
              <select
                id="task-owner"
                name="task-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllTasks}
                className="bg-transparent text-sm font-semibold uppercase tracking-[0.14em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/80"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
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
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">To do</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.todo}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">In progress</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.inProgress}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">Review</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.review}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">Completed</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.done}</p>
            <p className="mt-1 text-sm text-muted/80">tasks</p>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-border bg-surface p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs text-muted sm:w-auto sm:min-w-[250px]">
              <input
                type="search"
                placeholder="Search tasks..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/80"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-[var(--surface-muted)] p-1">
              {(['all', 'todo', 'in-progress', 'review', 'done'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
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

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-2xl border border-border bg-surface p-1">
              {taskViewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setViewMode(option.value)}
                  className={`rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                    viewMode === option.value ? 'bg-text text-bg' : 'text-muted'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted/80">{filteredTasks.length} tasks visible</p>
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
        ) : viewMode === 'list' ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
            {filteredTasks.map((task) => renderBoardTaskCard(task, 'list'))}
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
                <p className="mt-2 text-sm text-muted/80">Click to create a new task in this view</p>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-4">
            {([
              { key: 'todo', label: 'To Do' },
              { key: 'in-progress', label: 'In Progress' },
              { key: 'review', label: 'Review' },
              { key: 'done', label: 'Completed' },
            ] as const).map((column) => (
              <div key={column.key} className="rounded-3xl border border-border bg-surface p-3">
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
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
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
                    <div className="mt-3">
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
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
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
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAdvancedOpen((prev) => !prev)}
                  className="col-span-2 rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                >
                  {isAdvancedOpen ? 'Hide advanced options' : 'Advanced options'}
                </button>

                {isAdvancedOpen ? (
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
                    <div className="col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Reference model number
                      </label>
                      <input
                        value={formState.referenceModelNumber}
                        onChange={(event) =>
                          setFormState((prev) => ({
                            ...prev,
                            referenceModelNumber: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                        placeholder="XYZ-123"
                      />
                    </div>
                  </div>
                ) : null}

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
    </div>
  );
}

