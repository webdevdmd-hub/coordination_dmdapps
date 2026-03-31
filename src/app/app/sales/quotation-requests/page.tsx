'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseQuotationRequestRepository } from '@/adapters/repositories/firebaseQuotationRequestRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { Project } from '@/core/entities/project';
import {
  QuotationRequest,
  QuotationRequestTask,
  QuotationRequestStatus,
} from '@/core/entities/quotationRequest';
import { useAuth } from '@/components/auth/AuthProvider';
import { getFirebaseAuth } from '@/frameworks/firebase/client';
import {
  getModuleCacheEntry,
  isModuleCacheFresh,
  MODULE_CACHE_TTL_MS,
  setModuleCacheEntry,
} from '@/lib/moduleDataCache';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries } from '@/lib/roles';
import {
  buildRecipientList,
  emitNotificationEventSafe,
  getModuleNotificationPermissions,
} from '@/lib/notifications';
import { filterAssignableUsers } from '@/lib/assignees';
import { filterUsersByRole, hasUserVisibilityAccess } from '@/lib/roleVisibility';

type EligibleUser = {
  id: string;
  name: string;
  roleKey: string;
  roleName: string;
};

type SalesOrderRequestFormState = {
  projectId: string;
  estimateNumber: string;
  estimateAmount: string;
  salesOrderNumber: string;
  salesOrderAmount: string;
  salesOrderDate: string;
};

const priorityStyles: Record<string, string> = {
  low: 'bg-[#00B67A]/14 text-[#00B67A]',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
};

const statusStyles: Record<QuotationRequestStatus, string> = {
  new: 'bg-surface-strong text-text',
  review: 'bg-[#00B67A]/16 text-[#00B67A]',
  approved: 'bg-[#00B67A]/22 text-[#00B67A]',
  rejected: 'bg-amber-200 text-amber-800',
  completed: 'bg-emerald-600 text-white',
};

const taskStatusStyles: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  assigned: 'bg-blue-100 text-blue-700',
  done: 'bg-[#00B67A]/14 text-[#00B67A]',
};

const formatDate = (value: string) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return date.toLocaleDateString();
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptySalesOrderForm = (): SalesOrderRequestFormState => ({
  projectId: '',
  estimateNumber: '',
  estimateAmount: '',
  salesOrderNumber: '',
  salesOrderAmount: '',
  salesOrderDate: todayKey(),
});

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
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [allUsers, setAllUsers] = useState<Array<{ id: string; role: string; active: boolean }>>(
    [],
  );
  const [statusFilter, setStatusFilter] = useState<QuotationRequestStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [activeSalesOrderTaskId, setActiveSalesOrderTaskId] = useState<string | null>(null);
  const [activeAddTaskId, setActiveAddTaskId] = useState<string | null>(null);
  const [customTaskTitle, setCustomTaskTitle] = useState('');
  const [customTaskAssignee, setCustomTaskAssignee] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [salesOrderFormState, setSalesOrderFormState] = useState<SalesOrderRequestFormState>(() =>
    emptySalesOrderForm(),
  );
  const [isSalesOrderModalOpen, setIsSalesOrderModalOpen] = useState(false);
  const [isSalesOrderSubmitting, setIsSalesOrderSubmitting] = useState(false);
  const [salesOrderError, setSalesOrderError] = useState<string | null>(null);
  const [salesOrderSuccess, setSalesOrderSuccess] = useState<string | null>(null);

  const canView = !!user && hasPermission(user.permissions, ['admin', 'quotation_request_view']);
  const canDelete =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_delete']);
  const canAssign =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_assign']);
  const canRequestSalesOrder =
    !!user && hasPermission(user.permissions, ['admin', 'sales_order_request_create']);
  const canViewProjects = !!user && hasPermission(user.permissions, ['admin', 'project_view']);
  const canViewAllProjects =
    !!user && hasPermission(user.permissions, ['admin', 'project_view_all']);
  const hasUserVisibility = hasUserVisibilityAccess(user, 'quotationRequests', user?.roleRelations);

  const visibleUsers = useMemo(
    () => filterUsersByRole(user, allUsers, 'quotationRequests', user?.roleRelations),
    [user, allUsers],
  );
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
  const quotationRequestsCacheKey = useMemo(() => {
    if (!user) {
      return null;
    }
    const scopeKey = user.permissions.includes('admin')
      ? 'admin'
      : hasUserVisibility
        ? `visible:${visibleUserScope}`
        : `self:${user.id}`;
    return ['quotation-requests', user.id, scopeKey].join(':');
  }, [user, hasUserVisibility, visibleUserScope]);
  const cachedRequestsEntry = quotationRequestsCacheKey
    ? getModuleCacheEntry<{
        requests: QuotationRequest[];
        tasksByRequest: Record<string, QuotationRequestTask[]>;
      }>(quotationRequestsCacheKey)
    : null;
  const [requests, setRequests] = useState<QuotationRequest[]>(
    () => cachedRequestsEntry?.data.requests ?? [],
  );
  const [tasksByRequest, setTasksByRequest] = useState<Record<string, QuotationRequestTask[]>>(
    () => cachedRequestsEntry?.data.tasksByRequest ?? {},
  );
  const [isLoading, setIsLoading] = useState(() => !cachedRequestsEntry);
  const requestsRef = useRef(requests);
  const tasksByRequestRef = useRef(tasksByRequest);

  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  useEffect(() => {
    tasksByRequestRef.current = tasksByRequest;
  }, [tasksByRequest]);

  const syncRequestsState = useCallback(
    (
      nextRequests: QuotationRequest[],
      nextTasksByRequest: Record<string, QuotationRequestTask[]>,
    ) => {
      setRequests(nextRequests);
      setTasksByRequest(nextTasksByRequest);
      if (quotationRequestsCacheKey) {
        setModuleCacheEntry(quotationRequestsCacheKey, {
          requests: nextRequests,
          tasksByRequest: nextTasksByRequest,
        });
      }
    },
    [quotationRequestsCacheKey],
  );

  const updateRequests = useCallback(
    (updater: (current: QuotationRequest[]) => QuotationRequest[]) => {
      setRequests((current) => {
        const next = updater(current);
        requestsRef.current = next;
        if (quotationRequestsCacheKey) {
          setModuleCacheEntry(quotationRequestsCacheKey, {
            requests: next,
            tasksByRequest: tasksByRequestRef.current,
          });
        }
        return next;
      });
    },
    [quotationRequestsCacheKey],
  );

  const updateTasksByRequest = useCallback(
    (
      updater: (
        current: Record<string, QuotationRequestTask[]>,
      ) => Record<string, QuotationRequestTask[]>,
    ) => {
      setTasksByRequest((current) => {
        const next = updater(current);
        tasksByRequestRef.current = next;
        if (quotationRequestsCacheKey) {
          setModuleCacheEntry(quotationRequestsCacheKey, {
            requests: requestsRef.current,
            tasksByRequest: next,
          });
        }
        return next;
      });
    },
    [quotationRequestsCacheKey],
  );

  useEffect(() => {
    let isActive = true;
    const loadRecipients = async () => {
      const recipientsCacheKey = user ? `quotation-requests-recipients:${user.id}` : null;
      const cachedEntry = recipientsCacheKey
        ? getModuleCacheEntry<{
            eligibleUsers: EligibleUser[];
            allUsers: Array<{ id: string; role: string; active: boolean }>;
          }>(recipientsCacheKey)
        : null;
      if (cachedEntry) {
        setEligibleUsers(cachedEntry.data.eligibleUsers);
        setAllUsers(cachedEntry.data.allUsers);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        const [roles, users] = await Promise.all([
          fetchRoleSummaries(),
          firebaseUserRepository.listAll(),
        ]);
        if (!isActive) {
          return;
        }
        const roleMap = new Map(roles.map((role) => [role.key.trim().toLowerCase(), role]));
        const isAdmin = Boolean(user?.permissions.includes('admin'));
        const assignableUserIds = new Set(
          (isAdmin
            ? users.filter((userItem) => userItem.active)
            : filterAssignableUsers(users, roles, 'quotation_request_assign', {
                currentUser: user,
                moduleKey: 'quotationRequests',
              })
          ).map((entry) => entry.id),
        );
        const filtered = users
          .filter((userItem) => userItem.active)
          .map((userItem) => {
            const roleKey = userItem.role?.trim().toLowerCase();
            const role = roleKey ? roleMap.get(roleKey) : null;
            if (!role) {
              return null;
            }
            if (
              !role.permissions.includes('quotation_request_assign') &&
              !role.permissions.includes('admin')
            ) {
              return null;
            }
            if (!assignableUserIds.has(userItem.id)) {
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
        const allUsersList = users.map((entry) => ({
          id: entry.id,
          role: entry.role,
          active: entry.active,
        }));
        setEligibleUsers(filtered);
        setAllUsers(allUsersList);
        if (recipientsCacheKey) {
          setModuleCacheEntry(recipientsCacheKey, {
            eligibleUsers: filtered,
            allUsers: allUsersList,
          });
        }
      } catch {
        if (isActive) {
          setEligibleUsers([]);
          setAllUsers([]);
        }
      }
    };
    loadRecipients();
    return () => {
      isActive = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !canViewProjects) {
      setProjects([]);
      return;
    }
    let isActive = true;
    const loadProjects = async () => {
      const projectsCacheKey = [
        'quotation-requests-projects',
        user.id,
        canViewAllProjects ? 'all' : user.role,
      ].join(':');
      const cachedEntry = getModuleCacheEntry<Project[]>(projectsCacheKey);
      if (cachedEntry) {
        setProjects(cachedEntry.data);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        const result = canViewAllProjects
          ? await firebaseProjectRepository.listAll()
          : await firebaseProjectRepository.listForUser(user.id, user.role);
        if (isActive) {
          setProjects(result);
          setModuleCacheEntry(projectsCacheKey, result);
        }
      } catch {
        if (isActive) {
          setProjects([]);
        }
      }
    };
    loadProjects();
    return () => {
      isActive = false;
    };
  }, [user, canViewProjects, canViewAllProjects]);

  useEffect(() => {
    const cachedEntry = quotationRequestsCacheKey
      ? getModuleCacheEntry<{
          requests: QuotationRequest[];
          tasksByRequest: Record<string, QuotationRequestTask[]>;
        }>(quotationRequestsCacheKey)
      : null;
    if (!cachedEntry) {
      return;
    }
    setRequests(cachedEntry.data.requests);
    setTasksByRequest(cachedEntry.data.tasksByRequest);
    setIsLoading(false);
  }, [quotationRequestsCacheKey]);

  useEffect(() => {
    if (!user || !canView) {
      setRequests([]);
      setTasksByRequest({});
      setIsLoading(false);
      return;
    }
    let isActive = true;
    const loadRequests = async () => {
      const cachedEntry = quotationRequestsCacheKey
        ? getModuleCacheEntry<{
            requests: QuotationRequest[];
            tasksByRequest: Record<string, QuotationRequestTask[]>;
          }>(quotationRequestsCacheKey)
        : null;
      if (cachedEntry) {
        setRequests(cachedEntry.data.requests);
        setTasksByRequest(cachedEntry.data.tasksByRequest);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
      setError(null);
      try {
        const rawRequests = (await firebaseQuotationRequestRepository.listAll()) as Array<
          Record<string, unknown>
        >;
        const normalized = rawRequests.map((entry) => normalizeRequest(entry));
        const visible = user.permissions.includes('admin')
          ? normalized
          : hasUserVisibility
            ? normalized.filter(
                (request) =>
                  visibleUserIds.has(request.requestedBy) ||
                  request.recipients?.some((recipient) => visibleUserIds.has(recipient.id)),
              )
            : normalized.filter(
                (request) =>
                  request.requestedBy === user.id ||
                  request.recipients?.some((recipient) => recipient.id === user.id),
              );
        if (!isActive) {
          return;
        }
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
        syncRequestsState(visible, map);
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
  }, [
    user,
    canView,
    hasUserVisibility,
    visibleUserIds,
    quotationRequestsCacheKey,
    syncRequestsState,
  ]);

  useEffect(() => {
    if (!activeRequestId) {
      return;
    }
    let active = true;
    const refreshActiveRequestTasks = async () => {
      try {
        const latestTasks = (await firebaseQuotationRequestRepository.listTasks(
          activeRequestId,
        )) as QuotationRequestTask[];
        if (!active) {
          return;
        }
        updateTasksByRequest((prev) => ({
          ...prev,
          [activeRequestId]: latestTasks,
        }));
      } catch {
        // Keep the current modal state if the refresh fails.
      }
    };
    void refreshActiveRequestTasks();
    const intervalId = window.setInterval(() => {
      void refreshActiveRequestTasks();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeRequestId, updateTasksByRequest]);

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
      completed: requests.filter((request) => request.status === 'completed').length,
    };
  }, [requests]);

  const selectedViewIndex = viewMode === 'cards' ? 1 : 0;
  const requestStatusFilterOptions = [
    'all',
    'new',
    'review',
    'approved',
    'rejected',
    'completed',
  ] as const;
  const selectedRequestStatusIndex = Math.max(0, requestStatusFilterOptions.indexOf(statusFilter));

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

  const activeSalesOrderTask = useMemo(
    () => activeTasks.find((task) => task.id === activeSalesOrderTaskId) ?? null,
    [activeTasks, activeSalesOrderTaskId],
  );

  const isEstimateTask = (task: QuotationRequestTask) =>
    task.tag.trim().toLowerCase() === 'estimate';

  const getProjectOptionsForRequest = (request: QuotationRequest) =>
    projects.filter((project) => project.customerId === request.customerId);

  const handleOpenSalesOrderModal = (request: QuotationRequest, task: QuotationRequestTask) => {
    if (!canRequestSalesOrder || task.status !== 'done' || !isEstimateTask(task)) {
      return;
    }
    const projectOptions = getProjectOptionsForRequest(request);
    setActiveSalesOrderTaskId(task.id);
    setSalesOrderFormState({
      ...emptySalesOrderForm(),
      projectId: projectOptions[0]?.id ?? '',
      estimateNumber: task.estimateNumber ?? '',
      estimateAmount:
        typeof task.estimateAmount === 'number' && Number.isFinite(task.estimateAmount)
          ? String(task.estimateAmount)
          : '',
    });
    setSalesOrderError(null);
    setSalesOrderSuccess(null);
    setIsSalesOrderModalOpen(true);
  };

  const handleSubmitSalesOrderRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !activeRequest || !canRequestSalesOrder) {
      return;
    }
    const projectId = salesOrderFormState.projectId.trim();
    const estimateNumber = salesOrderFormState.estimateNumber.trim();
    const salesOrderNumber = salesOrderFormState.salesOrderNumber.trim();
    const salesOrderDate = salesOrderFormState.salesOrderDate.trim();
    const estimateAmount = Number(salesOrderFormState.estimateAmount);
    const salesOrderAmount = Number(salesOrderFormState.salesOrderAmount);

    if (!projectId) {
      setSalesOrderError('Project is required.');
      return;
    }
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
        projectId,
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
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: payload,
        });
        if (candidate.status !== 404) {
          response = candidate;
          break;
        }
      }
      if (!response) {
        setSalesOrderError('Unable to submit Sales Order Req (no response).');
        return;
      }
      const data = (await response.json().catch(() => ({}))) as Record<string, string>;
      if (!response.ok) {
        setSalesOrderError(
          data.error ?? `Unable to submit Sales Order Req (HTTP ${response.status}).`,
        );
        return;
      }
      const now = new Date().toISOString();
      await firebaseLeadRepository.addActivity(activeRequest.leadId, {
        type: 'note',
        note: `Sales Order Req submitted from RFQ Estimate task (${estimateNumber}).`,
        date: now,
        createdBy: user.id,
      });
      const requestNo = data.requestNo ?? 'Sales Order Req';
      setSalesOrderSuccess(`${requestNo} submitted for approval.`);
    } catch {
      setSalesOrderError('Unable to submit Sales Order Req. Please try again.');
    } finally {
      setIsSalesOrderSubmitting(false);
    }
  };

  const handleAssignTask = async (
    request: QuotationRequest,
    task: QuotationRequestTask,
    userId: string,
  ) => {
    if (!user || !canAssign) {
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
        assignedUsers: [selected.id],
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
      try {
        await firebaseTaskRepository.update(taskId, {
          assignedTo: selected.id,
          assignedUsers: [selected.id],
          updatedAt: now,
        });
      } catch {
        const recreated = await firebaseTaskRepository.create({
          title: `${task.tag} · ${request.leadCompany}`,
          description: `RFQ task for ${request.leadName}`,
          assignedTo: selected.id,
          assignedUsers: [selected.id],
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
        taskId = recreated.id;
      }
    }
    const updated = (await firebaseQuotationRequestRepository.updateTask(request.id, task.id, {
      assignedTo: selected.id,
      assignedName: selected.name,
      taskId,
      status: 'assigned',
      updatedAt: now,
    })) as QuotationRequestTask;
    updateTasksByRequest((prev) => ({
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
      requiredPermissionsAnyOf: getModuleNotificationPermissions('quotationRequests'),
      meta: {
        leadId: request.leadId,
        taskTag: task.tag,
        assigneeId: selected.id,
      },
    });
  };

  const handleStartAddTask = (requestId: string) => {
    setActiveAddTaskId(requestId);
    setCustomTaskTitle('');
    setCustomTaskAssignee('');
  };

  const handleAddCustomTask = async (request: QuotationRequest) => {
    if (!user || !canAssign) {
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
      updateTasksByRequest((prev) => ({
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
        requiredPermissionsAnyOf: getModuleNotificationPermissions('quotationRequests'),
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
    updateRequests((prev) => prev.filter((item) => item.id !== requestId));
    updateTasksByRequest((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    if (activeRequestId === requestId) {
      setActiveRequestId(null);
      setActiveAddTaskId(null);
      setActiveSalesOrderTaskId(null);
      setCustomTaskTitle('');
      setCustomTaskAssignee('');
      setIsSalesOrderModalOpen(false);
      setSalesOrderError(null);
      setSalesOrderSuccess(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Quotation Requests
            </p>
            <h1 className="font-display text-5xl text-text">Request control for leads</h1>
            <p className="mt-3 max-w-3xl text-lg text-muted">
              Track every quotation request, delegate technical tasks, and keep the lead timeline in
              sync.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <div className="relative grid grid-cols-2 rounded-2xl border border-border bg-surface p-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-[var(--surface-soft)] shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out dark:bg-slate-50"
                style={{
                  width: 'calc((100% - 1rem) / 2)',
                  transform: `translateX(calc(${selectedViewIndex} * 100%))`,
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
                onClick={() => setViewMode('cards')}
                className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                  viewMode === 'cards' ? 'text-slate-900' : 'text-muted hover:text-text'
                }`}
              >
                Cards
              </button>
            </div>
            <button
              type="button"
              disabled={!canView}
              className="w-full rounded-2xl border border-[#00B67A]/30 bg-[#00B67A] px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(0,182,122,0.22)] transition hover:-translate-y-[1px] hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              View queue
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">New</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.newCount}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              In review
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.review}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Approved
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.approved}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Rejected
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.rejected}</p>
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
            <div className="w-full md:hidden">
              <div className="relative w-full rounded-lg border border-border bg-[var(--surface-muted)] p-1">
                <div className="relative z-[1] grid grid-cols-2 gap-1">
                  {requestStatusFilterOptions.map((status) => (
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
                      {status === 'all' ? 'All' : status}
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
                  width: `calc((100% - 0.5rem) / ${requestStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedRequestStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${requestStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {requestStatusFilterOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                      statusFilter === status ? 'text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {status === 'all' ? 'All' : status}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted/80">
            {filtered.length} requests visible
          </div>
        </div>

        <div
          className={
            viewMode === 'cards'
              ? 'mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3'
              : 'mt-6 space-y-4'
          }
        >
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
                  className={`rounded-3xl border border-border bg-surface p-4 text-left shadow-soft transition hover:-translate-y-[1px] hover:border-[#00B67A]/40 ${
                    viewMode === 'list' ? 'w-full' : ''
                  }`}
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
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00B67A]">
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

      {activeRequest && !isSalesOrderModalOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => {
            setActiveRequestId(null);
            setActiveAddTaskId(null);
            setActiveSalesOrderTaskId(null);
            setIsSalesOrderModalOpen(false);
            setSalesOrderError(null);
            setSalesOrderSuccess(null);
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
                <span
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                    statusStyles[activeRequest.status]
                  }`}
                >
                  {activeRequest.status}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveRequestId(null);
                    setActiveAddTaskId(null);
                    setActiveSalesOrderTaskId(null);
                    setIsSalesOrderModalOpen(false);
                    setSalesOrderError(null);
                    setSalesOrderSuccess(null);
                  }}
                  className="rounded-full border border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-[var(--surface-soft)]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-[var(--surface-soft)] py-2 text-center">
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-600">
                  Pending
                </p>
                <p className="mt-1 text-2xl font-semibold text-text">
                  {activeTasks.filter((task) => task.status === 'pending').length}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Assigned
                </p>
                <p className="mt-1 text-2xl font-semibold text-text">
                  {activeTasks.filter((task) => task.status === 'assigned').length}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#00B67A]">
                  Done
                </p>
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
                      {isEstimateTask(task) ? (
                        <div className="mt-2 space-y-1 text-xs text-[#00B67A]">
                          <p>Estimate No: {task.estimateNumber || '-'}</p>
                          <p>
                            Estimate Amount:{' '}
                            {typeof task.estimateAmount === 'number' &&
                            Number.isFinite(task.estimateAmount)
                              ? task.estimateAmount.toLocaleString()
                              : '-'}
                          </p>
                        </div>
                      ) : null}
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
                      {canRequestSalesOrder && isEstimateTask(task) && task.status === 'done' ? (
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleOpenSalesOrderModal(activeRequest, task)}
                            className="rounded-full border border-border/60 bg-[#00B67A] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-[#009f6b]"
                          >
                            Sales Order Req
                          </button>
                        </div>
                      ) : null}
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
                            className="rounded-2xl border border-[#00B67A]/30 bg-[#00B67A] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60"
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

      {isSalesOrderModalOpen && activeRequest && activeSalesOrderTask ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => {
            setIsSalesOrderModalOpen(false);
            setSalesOrderError(null);
            setSalesOrderSuccess(null);
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
                  {activeRequest.leadName} - Estimate
                </h3>
                <p className="mt-2 text-xs text-muted sm:text-sm">
                  Submit Sales Order details from the completed Estimate task.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSalesOrderModalOpen(false);
                  setSalesOrderError(null);
                  setSalesOrderSuccess(null);
                }}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmitSalesOrderRequest}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Project
                </label>
                <select
                  required
                  value={salesOrderFormState.projectId}
                  onChange={(event) =>
                    setSalesOrderFormState((prev) => ({
                      ...prev,
                      projectId: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                >
                  <option value="">Select project</option>
                  {getProjectOptionsForRequest(activeRequest).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

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
                <div className="rounded-2xl border border-[#00B67A]/40 bg-[#00B67A]/12 px-4 py-2 text-sm text-[#00B67A]">
                  {salesOrderSuccess}
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSalesOrderSubmitting}
                  className="rounded-full border border-border/60 bg-[#00B67A]/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-[1px] hover:bg-[#009f6b]/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSalesOrderSubmitting ? 'Submitting...' : 'Submit for approval'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}
