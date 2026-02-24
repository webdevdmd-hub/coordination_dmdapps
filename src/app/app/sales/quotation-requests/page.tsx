'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseQuotationRequestRepository } from '@/adapters/repositories/firebaseQuotationRequestRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import {
  QuotationRequest,
  QuotationRequestTask,
  QuotationRequestStatus,
} from '@/core/entities/quotationRequest';
import { useAuth } from '@/components/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries } from '@/lib/roles';
import { buildRecipientList, emitNotificationEventSafe } from '@/lib/notifications';

type EligibleUser = {
  id: string;
  name: string;
  roleKey: string;
  roleName: string;
};

const statusOptions: Array<{ value: QuotationRequestStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const priorityStyles: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
};

const statusStyles: Record<QuotationRequestStatus, string> = {
  new: 'bg-surface-strong text-text',
  review: 'bg-accent/70 text-text',
  approved: 'bg-emerald-200 text-emerald-900',
  rejected: 'bg-amber-200 text-amber-800',
};

const taskStatusStyles: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  assigned: 'bg-blue-100 text-blue-700',
  done: 'bg-emerald-100 text-emerald-700',
};

const formatDate = (value: string) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return date.toLocaleDateString();
};

const normalizeRequest = (raw: Record<string, unknown>): QuotationRequest => {
  const recipients = Array.isArray(raw.recipients) ? raw.recipients : [];
  return {
    id: String(raw.id ?? ''),
    leadId: String(raw.leadId ?? ''),
    leadName: String(raw.leadName ?? raw.customerName ?? 'Lead'),
    leadCompany: String(raw.leadCompany ?? raw.customerName ?? 'Customer'),
    leadEmail: String(raw.leadEmail ?? ''),
    customerId: String(raw.customerId ?? ''),
    requestedBy: String(raw.requestedBy ?? ''),
    requestedByName: String(raw.requestedByName ?? raw.requestedBy ?? 'User'),
    recipients: recipients as QuotationRequest['recipients'],
    priority: (raw.priority as QuotationRequest['priority']) ?? 'medium',
    notes: String(raw.notes ?? ''),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    status: (raw.status as QuotationRequestStatus) ?? 'new',
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };
};

export default function Page() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<QuotationRequest[]>([]);
  const [tasksByRequest, setTasksByRequest] = useState<Record<string, QuotationRequestTask[]>>({});
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [statusFilter, setStatusFilter] = useState<QuotationRequestStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [activeAddTaskId, setActiveAddTaskId] = useState<string | null>(null);
  const [customTaskTitle, setCustomTaskTitle] = useState('');
  const [customTaskAssignee, setCustomTaskAssignee] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  const canView = !!user && hasPermission(user.permissions, ['admin', 'quotation_request_view']);
  const canViewAllRequests =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_view_all']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'quotation_request_edit']);
  const canDelete =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_delete']);
  const canAssign =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_assign']);

  useEffect(() => {
    let isActive = true;
    const loadRecipients = async () => {
      try {
        const [roles, users] = await Promise.all([
          fetchRoleSummaries(),
          firebaseUserRepository.listAll(),
        ]);
        if (!isActive) {
          return;
        }
        const roleMap = new Map(roles.map((role) => [role.key.trim().toLowerCase(), role]));
        const filtered = users
          .filter((userItem) => userItem.active)
          .map((userItem) => {
            const roleKey = userItem.role?.trim().toLowerCase();
            const role = roleKey ? roleMap.get(roleKey) : null;
            if (!role) {
              return null;
            }
            if (role.key === 'admin' || role.permissions.includes('admin')) {
              return null;
            }
            if (!role.permissions.includes('quotation_request_assign')) {
              return null;
            }
            return {
              id: userItem.id,
              name: userItem.fullName,
              roleKey: role.key,
              roleName: role.name,
            } as EligibleUser;
          })
          .filter((value): value is EligibleUser => Boolean(value));
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        setEligibleUsers(filtered);
      } catch {
        if (isActive) {
          setEligibleUsers([]);
        }
      }
    };
    loadRecipients();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !canView) {
      setRequests([]);
      setTasksByRequest({});
      setIsLoading(false);
      return;
    }
    let isActive = true;
    const loadRequests = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const rawRequests = (await firebaseQuotationRequestRepository.listAll()) as Array<
          Record<string, unknown>
        >;
        const normalized = rawRequests.map((entry) => normalizeRequest(entry));
        const visible = canViewAllRequests
          ? normalized
          : normalized.filter(
              (request) =>
                request.requestedBy === user.id ||
                request.recipients?.some((recipient) => recipient.id === user.id),
            );
        if (!isActive) {
          return;
        }
        setRequests(visible);
        const tasksEntries = await Promise.all(
          visible.map(async (request) => {
            const tasks = (await firebaseQuotationRequestRepository.listTasks(
              request.id,
            )) as QuotationRequestTask[];
            return [request.id, tasks] as const;
          }),
        );
        if (!isActive) {
          return;
        }
        const map: Record<string, QuotationRequestTask[]> = {};
        tasksEntries.forEach(([id, tasks]) => {
          map[id] = tasks;
        });
        setTasksByRequest(map);
      } catch {
        if (isActive) {
          setError('Unable to load quotation requests.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };
    loadRequests();
    return () => {
      isActive = false;
    };
  }, [user, canView, canViewAllRequests]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesStatus = statusFilter === 'all' ? true : request.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [request.leadCompany, request.leadName, request.requestedByName]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [requests, statusFilter, search]);

  const totals = useMemo(() => {
    return {
      newCount: requests.filter((request) => request.status === 'new').length,
      review: requests.filter((request) => request.status === 'review').length,
      approved: requests.filter((request) => request.status === 'approved').length,
      rejected: requests.filter((request) => request.status === 'rejected').length,
    };
  }, [requests]);

  const activeRequest = useMemo(
    () => requests.find((request) => request.id === activeRequestId) ?? null,
    [requests, activeRequestId],
  );

  const activeTasks = useMemo(() => {
    if (!activeRequest) {
      return [] as QuotationRequestTask[];
    }
    return tasksByRequest[activeRequest.id] ?? [];
  }, [tasksByRequest, activeRequest]);

  const handleAssignTask = async (
    request: QuotationRequest,
    task: QuotationRequestTask,
    userId: string,
  ) => {
    if (!user || !canEdit || !canAssign) {
      return;
    }
    const selected = eligibleUsers.find((entry) => entry.id === userId);
    if (!selected) {
      return;
    }
    const now = new Date().toISOString();
    let taskId = task.taskId;
    if (!taskId) {
      const created = await firebaseTaskRepository.create({
        title: `${task.tag} · ${request.leadCompany}`,
        description: `RFQ task for ${request.leadName}`,
        assignedTo: selected.id,
        status: 'todo',
        priority: 'medium',
        recurrence: 'none',
        startDate: now.slice(0, 10),
        endDate: now.slice(0, 10),
        dueDate: now.slice(0, 10),
        parentTaskId: '',
        projectId: '',
        sharedRoles: [],
        createdBy: user.id,
        leadId: request.leadId,
        leadReference: request.leadName,
        quotationRequestId: request.id,
        quotationRequestTaskId: task.id,
        rfqTag: task.tag,
      });
      taskId = created.id;
    } else {
      await firebaseTaskRepository.update(taskId, { assignedTo: selected.id });
    }
    const updated = (await firebaseQuotationRequestRepository.updateTask(request.id, task.id, {
      assignedTo: selected.id,
      assignedName: selected.name,
      taskId,
      status: 'assigned',
      updatedAt: now,
    })) as QuotationRequestTask;
    setTasksByRequest((prev) => ({
      ...prev,
      [request.id]: (prev[request.id] ?? []).map((item) => (item.id === task.id ? updated : item)),
    }));
    const wasAssigned = Boolean(task.assignedTo);
    const fromName = task.assignedName ?? 'Unassigned';
    const note = wasAssigned
      ? `RFQ task reassigned: ${task.tag} from ${fromName} to ${selected.name}.`
      : `RFQ task assigned: ${task.tag} to ${selected.name}.`;
    const logged = await firebaseLeadRepository.addActivity(request.leadId, {
      type: 'note',
      note,
      date: now,
      createdBy: user.id,
    });
    if (logged) {
      // no-op: activity list is refreshed in lead modal
    }
    const recipients = buildRecipientList(request.requestedBy, [selected.id], user.id);
    await emitNotificationEventSafe({
      type: 'quotation_request.task_assigned',
      title: 'RFQ Task Assigned',
      body: `${user.fullName} assigned ${task.tag} for ${request.leadCompany}.`,
      actorId: user.id,
      recipients,
      entityType: 'quotationRequest',
      entityId: request.id,
      meta: {
        leadId: request.leadId,
        taskTag: task.tag,
        assigneeId: selected.id,
      },
    });
  };

  const handleStatusChange = async (request: QuotationRequest, status: QuotationRequestStatus) => {
    if (!canEdit || !user) {
      return;
    }
    const updated = (await firebaseQuotationRequestRepository.update(request.id, {
      status,
    })) as QuotationRequest;
    setRequests((prev) => prev.map((item) => (item.id === request.id ? updated : item)));
    await emitNotificationEventSafe({
      type: 'quotation_request.status_changed',
      title: 'Quotation Request Updated',
      body: `${user.fullName} changed ${request.leadCompany} to ${status}.`,
      actorId: user.id,
      recipients: buildRecipientList(request.requestedBy, [], user.id),
      entityType: 'quotationRequest',
      entityId: request.id,
      meta: {
        status,
        leadId: request.leadId,
      },
    });
  };

  const handleStartAddTask = (requestId: string) => {
    setActiveAddTaskId(requestId);
    setCustomTaskTitle('');
    setCustomTaskAssignee('');
  };

  const handleAddCustomTask = async (request: QuotationRequest) => {
    if (!user || !canEdit || !canAssign) {
      return;
    }
    if (!customTaskTitle.trim()) {
      setError('Task title is required.');
      return;
    }
    setIsAddingTask(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      let assignedName = '';
      let taskId: string | undefined;
      if (customTaskAssignee) {
        const selected = eligibleUsers.find((member) => member.id === customTaskAssignee);
        if (selected) {
          assignedName = selected.name;
          const createdTask = await firebaseTaskRepository.create({
            title: customTaskTitle.trim(),
            description: `RFQ task for ${request.leadName}`,
            assignedTo: selected.id,
            status: 'todo',
            priority: 'medium',
            recurrence: 'none',
            startDate: now.slice(0, 10),
            endDate: now.slice(0, 10),
            dueDate: now.slice(0, 10),
            parentTaskId: '',
            projectId: '',
            sharedRoles: [],
            createdBy: user.id,
            leadId: request.leadId,
            leadReference: request.leadName,
            quotationRequestId: request.id,
            quotationRequestTaskId: '',
            rfqTag: customTaskTitle.trim(),
          });
          taskId = createdTask.id;
        }
      }
      const createdTasks = await firebaseQuotationRequestRepository.addTasks(request.id, [
        {
          tag: customTaskTitle.trim(),
          status: customTaskAssignee ? 'assigned' : 'pending',
          assignedTo: customTaskAssignee || undefined,
          assignedName: assignedName || undefined,
          taskId,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const created = createdTasks[0];
      if (taskId && created?.id) {
        await firebaseTaskRepository.update(taskId, {
          quotationRequestTaskId: created.id,
        });
      }
      setTasksByRequest((prev) => ({
        ...prev,
        [request.id]: [created as QuotationRequestTask, ...(prev[request.id] ?? [])],
      }));
      const noteParts = [`RFQ custom task added: ${customTaskTitle.trim()}.`];
      if (assignedName) {
        noteParts.push(`Assigned to ${assignedName}.`);
      }
      await firebaseLeadRepository.addActivity(request.leadId, {
        type: 'note',
        note: noteParts.join(' '),
        date: now,
        createdBy: user.id,
      });
      const recipients = buildRecipientList(
        request.requestedBy,
        customTaskAssignee ? [customTaskAssignee] : [],
        user.id,
      );
      await emitNotificationEventSafe({
        type: 'quotation_request.task_created',
        title: 'RFQ Task Added',
        body: `${user.fullName} added ${customTaskTitle.trim()} for ${request.leadCompany}.`,
        actorId: user.id,
        recipients,
        entityType: 'quotationRequest',
        entityId: request.id,
        meta: {
          leadId: request.leadId,
          taskTag: customTaskTitle.trim(),
          assigneeId: customTaskAssignee || null,
        },
      });
      setActiveAddTaskId(null);
      setCustomTaskTitle('');
      setCustomTaskAssignee('');
    } catch {
      setError('Unable to add task. Please try again.');
    } finally {
      setIsAddingTask(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    if (!canDelete) {
      return;
    }
    const confirmed = window.confirm('Delete this quotation request?');
    if (!confirmed) {
      return;
    }
    await firebaseQuotationRequestRepository.delete(requestId);
    setRequests((prev) => prev.filter((item) => item.id !== requestId));
    setTasksByRequest((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    if (activeRequestId === requestId) {
      setActiveRequestId(null);
      setActiveAddTaskId(null);
      setCustomTaskTitle('');
      setCustomTaskAssignee('');
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border bg-surface p-6 shadow-soft md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Quotation Requests
            </p>
            <h1 className="font-display text-6xl text-text">Request control center</h1>
            <p className="mt-2 max-w-3xl text-2xl text-muted">
              Track every quotation request, delegate technical tasks, and keep the lead timeline in
              sync.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 md:w-auto">
            <button
              type="button"
              disabled={!canView}
              className="w-full rounded-2xl border border-accent/30 bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(6,151,107,0.22)] transition hover:-translate-y-[1px] hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              View queue
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">New</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.newCount}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              In review
            </p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.review}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Approved</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.approved}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Rejected</p>
            <p className="mt-4 text-6xl font-semibold text-text">{totals.rejected}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border bg-surface p-4 shadow-soft md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-2 text-xs text-muted md:w-auto md:min-w-[320px]">
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
                placeholder="Search requests"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 md:w-48"
              />
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-border bg-[var(--surface-muted)] p-2 md:w-auto md:flex md:flex-wrap md:items-center md:rounded-full md:p-1">
              {(['all', 'new', 'review', 'approved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`w-full shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition md:w-auto md:rounded-full ${
                    statusFilter === status
                      ? 'bg-accent text-white'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {status === 'all' ? 'All' : status}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted/80">
            {filtered.length} requests visible
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {!canView ? (
            <div className="col-span-full rounded-2xl border border-border bg-[var(--surface-soft)] p-4 text-sm text-muted">
              You do not have permission to view quotation requests.
            </div>
          ) : isLoading ? (
            <div className="col-span-full rounded-2xl border border-border bg-[var(--surface-soft)] p-4 text-sm text-muted">
              Loading quotation requests...
            </div>
          ) : filtered.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-border bg-[var(--surface-soft)] p-4 text-sm text-muted">
              No quotation requests match your filters.
            </div>
          ) : (
            filtered.map((request) => {
              const tasks = tasksByRequest[request.id] ?? [];
              const pendingCount = tasks.filter((task) => task.status === 'pending').length;
              const assignedCount = tasks.filter((task) => task.status === 'assigned').length;
              const doneCount = tasks.filter((task) => task.status === 'done').length;
              return (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setActiveRequestId(request.id)}
                  className="rounded-3xl border border-border bg-surface p-4 text-left shadow-soft transition hover:-translate-y-[1px] hover:border-accent/40"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">
                        {request.leadCompany}
                      </p>
                      <h3 className="mt-2 font-display text-2xl text-text">{request.leadName}</h3>
                      <div className="mt-2 space-y-2 text-sm text-muted">
                        <p className="flex items-center gap-2">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4 text-muted/80"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="m3 7 9 6 9-6" />
                          </svg>
                          {request.leadEmail}
                        </p>
                        <p className="flex items-center gap-2">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4 text-muted/80"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          Requested by{' '}
                          <span className="font-semibold text-text">{request.requestedByName}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <span
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] ${
                          statusStyles[request.status]
                        }`}
                      >
                        {request.status}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] ${
                          priorityStyles[request.priority] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {request.priority}
                      </span>
                      <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-sm text-muted">
                        {formatDate(request.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid w-full grid-cols-3 divide-x divide-border py-1 text-center">
                    <div className="px-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">
                        Pending
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-text">{pendingCount}</p>
                    </div>
                    <div className="px-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                        Assigned
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-text">{assignedCount}</p>
                    </div>
                    <div className="px-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
                        Done
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-text">{doneCount}</p>
                    </div>
                  </div>

                </button>
              );
            })
          )}
        </div>
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </section>

      {activeRequest ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => {
            setActiveRequestId(null);
            setActiveAddTaskId(null);
          }}
        >
          <DraggablePanel
            className="w-full max-w-4xl rounded-3xl border border-border bg-surface p-4 shadow-floating md:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/80">
                  {activeRequest.leadCompany}
                </p>
                <h3 className="mt-1 font-display text-3xl text-text">{activeRequest.leadName}</h3>
                <p className="mt-1 text-sm text-muted">{activeRequest.leadEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(activeRequest.id)}
                    className="rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 transition hover:bg-rose-100"
                  >
                    Delete request
                  </button>
                ) : null}
                <div className="relative">
                  <select
                    value={activeRequest.status}
                    onChange={(event) =>
                      handleStatusChange(
                        activeRequest,
                        event.target.value as QuotationRequestStatus,
                      )
                    }
                    disabled={!canEdit}
                    className="appearance-none rounded-full border border-accent/30 bg-accent px-5 py-2.5 pr-10 text-xs font-semibold uppercase tracking-[0.16em] text-white outline-none disabled:opacity-60"
                  >
                    {statusOptions.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                  <svg
                    viewBox="0 0 20 20"
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/80"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 7 5 6 5-6" />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveRequestId(null);
                    setActiveAddTaskId(null);
                  }}
                  className="rounded-full border border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-[var(--surface-soft)]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-[var(--surface-soft)] py-2 text-center">
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-600">Pending</p>
                <p className="mt-1 text-2xl font-semibold text-text">
                  {activeTasks.filter((task) => task.status === 'pending').length}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Assigned</p>
                <p className="mt-1 text-2xl font-semibold text-text">
                  {activeTasks.filter((task) => task.status === 'assigned').length}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600">Done</p>
                <p className="mt-1 text-2xl font-semibold text-text">
                  {activeTasks.filter((task) => task.status === 'done').length}
                </p>
              </div>
            </div>

            <details className="group mt-4 rounded-2xl border border-border bg-surface" open>
              <summary className="flex cursor-pointer items-center justify-between rounded-2xl bg-[var(--surface-soft)] px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                <span className="inline-flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted">
                    <svg
                      viewBox="0 0 20 20"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="14" height="12" rx="2" />
                      <path d="M6 8h8M6 11h6" />
                    </svg>
                  </span>
                  Task workflow
                </span>
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4 text-muted transition-transform duration-500 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m5 7 5 6 5-6" />
                </svg>
              </summary>
              <div className="space-y-2 border-t border-border p-2 max-h-[360px] overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/40 [&::-webkit-scrollbar-track]:bg-transparent">
                {activeTasks.length === 0 ? (
                  <div className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
                    No tasks created for this request yet.
                  </div>
                ) : (
                  activeTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-text">{task.tag}</p>
                          <p className="text-xs text-muted">{task.assignedName ?? 'Unassigned'}</p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                            taskStatusStyles[task.status] ?? taskStatusStyles.pending
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-3">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                          Assign to
                        </label>
                        <select
                          value={task.assignedTo ?? ''}
                          onChange={(event) =>
                            handleAssignTask(activeRequest, task, event.target.value)
                          }
                          disabled={!canAssign}
                          className="mt-2 w-full rounded-lg border border-border bg-[var(--surface-soft)] px-3 py-2 text-sm text-text outline-none"
                        >
                          <option value="" disabled>
                            Select teammate
                          </option>
                          {eligibleUsers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} - {member.roleName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))
                )}
                {canAssign ? (
                  <div className="rounded-xl border border-dashed border-border bg-surface p-3">
                    {activeAddTaskId === activeRequest.id ? (
                      <div className="space-y-3">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                          Task title
                          <input
                            value={customTaskTitle}
                            onChange={(event) => setCustomTaskTitle(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-border bg-[var(--surface-soft)] px-3 py-2 text-sm text-text outline-none"
                            placeholder="Add a custom task"
                          />
                        </label>
                        <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                          Assign to
                          <select
                            value={customTaskAssignee}
                            onChange={(event) => setCustomTaskAssignee(event.target.value)}
                            disabled={!canAssign}
                            className="mt-2 w-full rounded-lg border border-border bg-[var(--surface-soft)] px-3 py-2 text-sm text-text outline-none"
                          >
                            <option value="">Unassigned</option>
                            {eligibleUsers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name} - {member.roleName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setActiveAddTaskId(null)}
                            className="text-xs font-semibold uppercase tracking-[0.22em] text-muted"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddCustomTask(activeRequest)}
                            disabled={isAddingTask}
                            className="rounded-2xl border border-accent/30 bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isAddingTask ? 'Adding...' : 'Add task'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartAddTask(activeRequest.id)}
                        className="w-full rounded-full border border-border bg-[var(--surface-soft)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-[var(--surface-muted)]"
                      >
                        Add task
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </details>

            <details className="group mt-3 rounded-2xl border border-border bg-surface">
              <summary className="flex cursor-pointer items-center justify-between rounded-2xl bg-[var(--surface-soft)] px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                <span className="inline-flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted">
                    <svg
                      viewBox="0 0 20 20"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 2h8l4 4v12H6z" />
                      <path d="M14 2v4h4" />
                      <path d="M9 10h6M9 13h6" />
                    </svg>
                  </span>
                  Additional notices
                </span>
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4 text-muted transition-transform duration-500 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m5 7 5 6 5-6" />
                </svg>
              </summary>
              <div className="border-t border-border p-2">
                <div className="rounded-xl border border-border bg-[var(--surface-soft)] p-3 text-sm text-text">
                  {activeRequest.notes || 'No additional notes provided.'}
                </div>
              </div>
            </details>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}
