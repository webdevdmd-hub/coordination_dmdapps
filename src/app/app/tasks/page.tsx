'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

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
};

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

const statusColor: Record<TaskStatus, string> = {
  todo: 'bg-surface-strong/80 text-text',
  'in-progress': 'bg-accent/70 text-text',
  review: 'bg-indigo-500/20 text-indigo-200',
  done: 'bg-emerald-200 text-emerald-900',
};

const priorityColor: Record<TaskPriority, string> = {
  low: 'bg-emerald-500/20 text-black',
  medium: 'bg-amber-500/20 text-black',
  high: 'bg-rose-500/20 text-black',
  urgent: 'bg-rose-500 text-black',
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
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
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

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'task_view']);
  const canViewAllTasks = !!user && hasPermission(user.permissions, ['admin', 'task_view_all']);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'task_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'task_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'task_delete']);
  const canAssign = !!user && hasPermission(user.permissions, ['admin', 'task_assign']);

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
  });

  const [formState, setFormState] = useState<TaskFormState>(() => emptyTask(''));

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
    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && selectedTask) {
        const previousStatus = selectedTask.status;
        const updated = await firebaseTaskRepository.update(selectedTask.id, {
          ...formState,
          title: formState.title.trim(),
          description: formState.description.trim(),
          assignedUsers: formState.assignedUsers,
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
          ...formState,
          title: formState.title.trim(),
          description: formState.description.trim(),
          assignedUsers: formState.assignedUsers,
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
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: startedAt,
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
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      const totalSeconds = (task.totalTrackedSeconds ?? 0) + durationSeconds;
      const updated = await firebaseTaskRepository.update(task.id, {
        timerStartedAt: '',
        lastTimerStoppedAt: stoppedAt,
        lastTimerDurationSeconds: durationSeconds,
        totalTrackedSeconds: totalSeconds,
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
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-4 shadow-soft sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Tasks</p>
            <h1 className="font-display text-3xl text-text">Team task board</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Track tasks across modules with role-based shared visibility and due-date focus.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted sm:w-auto">
              <label htmlFor="task-owner" className="sr-only">
                Owner
              </label>
              <select
                id="task-owner"
                name="task-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllTasks}
                className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
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
              className="w-full rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              New task
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">To do</p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.todo}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              In progress
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.inProgress}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">Review</p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.review}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Completed
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.done}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-4 shadow-soft sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted sm:w-auto sm:rounded-full">
              <input
                type="search"
                placeholder="Search tasks"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 sm:w-48"
              />
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-bg/70 p-2 sm:w-auto sm:flex sm:flex-wrap sm:items-center sm:rounded-full sm:p-1">
              {(['all', 'todo', 'in-progress', 'review', 'done'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`w-full rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition sm:w-auto sm:rounded-full ${
                    statusFilter === status
                      ? 'bg-accent/80 text-text'
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
          <div className="text-xs text-muted">{filteredTasks.length} tasks visible</div>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            You do not have permission to view tasks.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            Loading tasks...
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {filteredTasks.map((task) => {
              const isRunning = !!task.timerStartedAt;
              const sessionSeconds = getSessionDuration(task);
              const totalSeconds = getLiveDuration(task);
              const canTrack = canTrackTask(task);
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
                  className="lift-hover cursor-pointer rounded-2xl border border-border/60 bg-bg/70 p-4 transition"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        {task.assignedTo
                          ? (ownerNameMap.get(task.assignedTo) ?? task.assignedTo)
                          : 'Unassigned'}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-text">{task.title}</p>
                      {task.projectId ? (
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200">
                          Project: {projectNameMap.get(task.projectId) ?? task.projectId}
                        </p>
                      ) : null}
                      {task.leadReference ? (
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                          Lead: {task.leadReference}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-muted">Due {formatDate(task.dueDate)}</p>
                      {task.referenceModelNumber ? (
                        <p className="mt-1 text-xs text-sky-200">
                          Ref: {task.referenceModelNumber}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {isRunning ? (
                          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-100">
                            Running {formatDuration(sessionSeconds)}
                          </span>
                        ) : null}
                        <span>Total {formatDuration(totalSeconds)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                          statusColor[task.status]
                        }`}
                      >
                        {task.status
                          .replace('-', ' ')
                          .replace(/\b\w/g, (value) => value.toUpperCase())}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                          priorityColor[task.priority]
                        }`}
                      >
                        {task.priority}
                      </span>
                      {isRunning ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleStopTaskTimer(task);
                          }}
                          disabled={!canTrack || timerBusyId === task.id}
                          className="rounded-full border border-rose-200/40 bg-rose-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {timerBusyId === task.id ? 'Stopping...' : 'Stop timer'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleStartTaskTimer(task);
                          }}
                          disabled={!canTrack || timerBusyId === task.id}
                          className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {timerBusyId === task.id ? 'Starting...' : 'Start timer'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(task)}
                        className="w-full rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-hover/80 sm:w-auto"
                      >
                        Update
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                      disabled={!canAssign}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    >
                      {!canAssign ? (
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
                  <div className="col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Quotation number
                    </label>
                    <input
                      value={formState.quotationNumber}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, quotationNumber: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      placeholder="Q-2026-0012"
                    />
                  </div>
                </div>

                <div className="col-span-2 grid gap-4 grid-cols-2">
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
                      End date
                    </label>
                    <input
                      type="date"
                      value={formState.endDate}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, endDate: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    />
                  </div>
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
