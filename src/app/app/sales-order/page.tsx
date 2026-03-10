'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

import { firebaseSalesOrderRequestRepository } from '@/adapters/repositories/firebaseSalesOrderRequestRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { SalesOrderRequest, SalesOrderRequestStatus } from '@/core/entities/salesOrderRequest';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { emitNotificationEventSafe } from '@/lib/notifications';
import { hasPermission } from '@/lib/permissions';
import { addSalesOrderTimelineEvent, listSalesOrderTimelineEvents } from '@/lib/salesOrderTimeline';

type SalesOrderActivity = {
  id: string;
  note: string;
  date: string;
  actorName?: string;
  createdBy?: string;
  type?: string;
};

const statusChipStyles: Record<SalesOrderRequestStatus, string> = {
  draft: 'bg-surface-strong text-text',
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-200 text-emerald-900',
  rejected: 'bg-rose-200 text-rose-900',
  cancelled: 'bg-slate-300 text-slate-800',
};

const formatStatusLabel = (value: SalesOrderRequestStatus) =>
  value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const formatDateTime = (value?: string) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
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

const formatDate = (value?: string) => {
  if (!value) {
    return '-';
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString();
};

const formatAmount = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

const formatStoreHandoffStatus = (request: SalesOrderRequest) => {
  if (request.handoffToStore === 'received') {
    return 'Received';
  }
  if (request.handoffToStore === 'queued') {
    return 'Queued';
  }
  return 'Not queued';
};

const activityDotClass = (activity: SalesOrderActivity) => {
  if (activity.type === 'sent_to_store') {
    return 'bg-blue-500';
  }
  if (activity.type === 'store_received') {
    return 'bg-emerald-500';
  }
  const note = (activity.note || '').toLowerCase();
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

const logPoDecisionActivity = async (
  request: SalesOrderRequest,
  actorId: string,
  status: 'approved' | 'rejected',
  rejectionReason?: string,
) => {
  const note =
    status === 'approved'
      ? `Sales Order Req ${request.requestNo} approved by Sales Order.`
      : `Sales Order Req ${request.requestNo} rejected by Sales Order. Reason: ${
          rejectionReason || 'Not specified'
        }.`;
  await addDoc(
    collection(getFirebaseDb(), 'sales', 'main', 'projects', request.projectId, 'activities'),
    {
      type: 'note',
      note,
      date: new Date().toISOString(),
      createdBy: actorId,
    },
  );
};

const logStoreHandoffActivity = async (
  request: SalesOrderRequest,
  actorId: string,
  actorName: string,
) => {
  const now = new Date().toISOString();
  await Promise.all([
    addDoc(collection(getFirebaseDb(), 'sales', 'main', 'projects', request.projectId, 'activities'), {
      type: 'note',
      note: `Sales Order Req ${request.requestNo} sent to Store by ${actorName}.`,
      date: now,
      createdBy: actorId,
    }),
    addSalesOrderTimelineEvent({
      requestId: request.id,
      requestNo: request.requestNo,
      projectId: request.projectId,
      type: 'sent_to_store',
      note: `Sales Order Req ${request.requestNo} sent to Store by ${actorName}.`,
      actorId,
      actorName,
      date: now,
    }),
  ]);
};

const notifyRequester = async (
  request: SalesOrderRequest,
  actorId: string,
  actorName: string,
  status: 'approved' | 'rejected',
  rejectionReason?: string,
) => {
  if (!request.requestedBy || request.requestedBy === actorId) {
    return;
  }
  const body =
    status === 'approved'
      ? `${actorName} approved ${request.requestNo} for ${request.projectName}.`
      : `${actorName} rejected ${request.requestNo} for ${request.projectName}.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`;
  await emitNotificationEventSafe({
    type: status === 'approved' ? 'sales_order_request.approved' : 'sales_order_request.rejected',
    title: status === 'approved' ? 'Sales Order Req Approved' : 'Sales Order Req Rejected',
    body,
    actorId,
    recipients: [request.requestedBy],
    entityType: 'salesOrderRequest',
    entityId: request.id,
    meta: {
      requestNo: request.requestNo,
      projectId: request.projectId,
      status,
      rejectionReason: rejectionReason ?? '',
    },
  });
};

export default function Page() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SalesOrderRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<SalesOrderRequestStatus | 'all'>(
    'pending_approval',
  );
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [selectedRequest, setSelectedRequest] = useState<SalesOrderRequest | null>(null);
  const [detailsTab, setDetailsTab] = useState<'details' | 'timeline'>('details');
  const [timelineActivities, setTimelineActivities] = useState<SalesOrderActivity[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectRequest, setRejectRequest] = useState<SalesOrderRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canView = !!user &&
    hasPermission(user.permissions, ['admin', 'sales_order_request_view', 'sales_order_request_view']);
  const canApprove = !!user &&
    hasPermission(user.permissions, [
      'admin',
      'sales_order_request_approve',
      'sales_order_request_approve',
    ]);

  useEffect(() => {
    if (!canView) {
      setRequests([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await firebaseSalesOrderRequestRepository.listAll();
        if (!active) {
          return;
        }
        result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRequests(result);
      } catch {
        if (active) {
          setError('Unable to load Sales Order Reqs.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [canView]);

  useEffect(() => {
    if (!selectedRequest) {
      setTimelineActivities([]);
      setIsLoadingTimeline(false);
      setIsTimelineOpen(false);
      return;
    }

    let active = true;
    const loadTimeline = async () => {
      setIsLoadingTimeline(true);
      try {
        if (!active) {
          return;
        }
        const timelineEvents = await listSalesOrderTimelineEvents(selectedRequest.id);
        if (!active) {
          return;
        }
        const items: SalesOrderActivity[] =
          timelineEvents.length > 0
            ? timelineEvents.map((event) => ({
                id: event.id,
                note: event.note,
                date: event.date,
                actorName: event.actorName,
                createdBy: event.actorId,
                type: event.type,
              }))
            : [
                ...(selectedRequest.handedOffAt
                  ? [
                      {
                        id: `fallback-sent-${selectedRequest.id}`,
                        note: `Sales Order Req ${selectedRequest.requestNo} sent to Store by ${selectedRequest.handedOffByName || 'Unknown'}.`,
                        date: selectedRequest.handedOffAt,
                        actorName: selectedRequest.handedOffByName || 'Unknown',
                        createdBy: selectedRequest.handedOffBy || '',
                        type: 'sent_to_store',
                      },
                    ]
                  : []),
                ...(selectedRequest.storeReceived && selectedRequest.storeReceivedAt
                  ? [
                      {
                        id: `fallback-received-${selectedRequest.id}`,
                        note: `Sales Order Req ${selectedRequest.requestNo} marked as received by Store (${selectedRequest.storeReceivedByName || 'Unknown'}).`,
                        date: selectedRequest.storeReceivedAt,
                        actorName: selectedRequest.storeReceivedByName || 'Unknown',
                        createdBy: selectedRequest.storeReceivedBy || '',
                        type: 'store_received',
                      },
                    ]
                  : []),
              ].sort((a, b) => b.date.localeCompare(a.date));
        setTimelineActivities(items);
      } catch {
        if (active) {
          setTimelineActivities([]);
        }
      } finally {
        if (active) {
          setIsLoadingTimeline(false);
        }
      }
    };

    loadTimeline();
    return () => {
      active = false;
    };
  }, [selectedRequest]);

  const filteredRequests = useMemo(
    () =>
      requests.filter((item) => (statusFilter === 'all' ? true : item.status === statusFilter)),
    [requests, statusFilter],
  );

  const totals = useMemo(
    () => ({
      pending: requests.filter((item) => item.status === 'pending_approval').length,
      approved: requests.filter((item) => item.status === 'approved').length,
      rejected: requests.filter((item) => item.status === 'rejected').length,
    }),
    [requests],
  );
  const salesOrderStatusFilterOptions: ReadonlyArray<SalesOrderRequestStatus | 'all'> = [
    'pending_approval',
    'approved',
    'rejected',
    'all',
  ];
  const selectedSalesOrderStatusIndex = Math.max(
    0,
    salesOrderStatusFilterOptions.indexOf(statusFilter),
  );

  const applyStatusUpdate = async (
    request: SalesOrderRequest,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): Promise<boolean> => {
    if (!user || !canApprove) {
      return false;
    }
    setIsSaving(request.id);
    setError(null);
    const now = new Date().toISOString();
    const approval =
      status === 'approved'
        ? {
            ...request.approval,
            approvedBy: user.id,
            approvedByName: user.fullName,
            approvedAt: now,
            rejectedBy: '',
            rejectedByName: '',
            rejectedAt: '',
            rejectionReason: '',
          }
        : {
            ...request.approval,
            rejectedBy: user.id,
            rejectedByName: user.fullName,
            rejectedAt: now,
            rejectionReason: rejectionReason ?? '',
          };
    const handoff =
      status === 'approved'
        ? {
            handoffToStore: 'queued' as const,
            handedOffAt: now,
            handedOffBy: user.id,
            handedOffByName: user.fullName,
            storeReceived: false,
            storeReceivedAt: '',
            storeReceivedBy: '',
            storeReceivedByName: '',
          }
        : {};

    try {
      const updated = await firebaseSalesOrderRequestRepository.update(request.id, {
        status,
        approval,
        ...handoff,
        updatedAt: now,
      });
      setRequests((prev) => prev.map((item) => (item.id === request.id ? updated : item)));
      setSelectedRequest((prev) => (prev?.id === request.id ? updated : prev));
      await Promise.allSettled([
        logPoDecisionActivity(request, user.id, status, rejectionReason),
        notifyRequester(request, user.id, user.fullName, status, rejectionReason),
        ...(status === 'approved' ? [logStoreHandoffActivity(request, user.id, user.fullName)] : []),
      ]);
      return true;
    } catch {
      setError('Unable to update Sales Order Req status.');
      return false;
    } finally {
      setIsSaving(null);
    }
  };

  const handleApprove = async (request: SalesOrderRequest) => {
    await applyStatusUpdate(request, 'approved');
  };

  const openRejectModal = (request: SalesOrderRequest) => {
    setRejectRequest(request);
    setRejectReason(request.approval?.rejectionReason ?? '');
    setError(null);
  };

  const handleRejectSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rejectRequest) {
      return;
    }
    if (!rejectReason.trim()) {
      setError('Rejection reason is required.');
      return;
    }
    const ok = await applyStatusUpdate(rejectRequest, 'rejected', rejectReason.trim());
    if (ok) {
      setRejectRequest(null);
      setRejectReason('');
    }
  };

  const openRequestDetails = (request: SalesOrderRequest, tab: 'details' | 'timeline') => {
    setSelectedRequest(request);
    setDetailsTab(tab);
    setIsTimelineOpen(false);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Sales Order
            </p>
            <h1 className="font-display text-5xl text-text">Sales Order requests</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Review Sales Order Reqs and complete approval decisions.
            </p>
          </div>
          <div className="relative grid grid-cols-2 rounded-2xl border border-border bg-surface p-2">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-text shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out"
              style={{
                width: 'calc((100% - 1rem) / 2)',
                transform: viewMode === 'card' ? 'translateX(100%)' : 'translateX(0)',
              }}
            />
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                viewMode === 'list' ? 'text-white' : 'text-muted hover:text-text'
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                viewMode === 'card' ? 'text-white' : 'text-muted hover:text-text'
              }`}
            >
              Cards
            </button>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full rounded-2xl border border-border bg-[var(--surface-muted)] p-1 md:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${salesOrderStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedSalesOrderStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${salesOrderStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setStatusFilter('pending_approval')}
                  className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    statusFilter === 'pending_approval' ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  Pending ({totals.pending})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('approved')}
                  className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    statusFilter === 'approved' ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  Approved ({totals.approved})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('rejected')}
                  className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    statusFilter === 'rejected' ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  Rejected ({totals.rejected})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    statusFilter === 'all' ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  All ({requests.length})
                </button>
              </div>
            </div>
          </div>
        </div>

        {!canView ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            You do not have permission to view Sales Order Reqs.
          </div>
        ) : isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            Loading Sales Order Reqs...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            No Sales Order Reqs found for this filter.
          </div>
        ) : (
          <div
            className={
              viewMode === 'card' ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'
            }
          >
            {filteredRequests.map((request) => (
              <section
                key={request.id}
                role="button"
                tabIndex={0}
                onClick={() => openRequestDetails(request, 'details')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openRequestDetails(request, 'details');
                  }
                }}
                className={`lift-hover cursor-pointer rounded-xl border border-border/60 bg-surface/80 p-3 shadow-soft transition ${
                  viewMode === 'list' ? 'w-full' : ''
                }`}
              >
                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                      Request No. {request.requestNo}
                    </p>
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusChipStyles[request.status]}`}
                    >
                      {formatStatusLabel(request.status)}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-text [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                      {request.projectName}
                    </h3>
                    <p className="mt-1 text-xs text-muted">Requested by: {request.requestedByName}</p>
                    {request.status === 'rejected' && request.approval?.rejectionReason ? (
                      <p className="mt-1 text-xs text-rose-200">
                        Rejection Reason: {request.approval.rejectionReason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRequestDetails(request, 'timeline');
                        }}
                        className="h-8 rounded-lg border border-border/60 bg-bg/70 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted transition hover:text-text"
                      >
                        Timeline
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRequestDetails(request, 'details');
                        }}
                        className="h-8 rounded-lg border border-border/60 bg-bg/70 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted transition hover:text-text"
                      >
                        Details
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {request.status === 'pending_approval' && canApprove ? (
                        <>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleApprove(request);
                            }}
                            disabled={isSaving === request.id}
                            className="h-8 rounded-lg border border-border/60 bg-emerald-500/80 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSaving === request.id ? 'Saving...' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openRejectModal(request);
                            }}
                            disabled={isSaving === request.id}
                            className="h-8 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {selectedRequest ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-border/60 bg-surface p-4 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                    Request No. {selectedRequest.requestNo}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-text">
                    {selectedRequest.projectName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRequest(null)}
                  className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted hover:text-text"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 inline-flex rounded-full border border-border/60 bg-bg/70 p-1">
                <button
                  type="button"
                  onClick={() => setDetailsTab('details')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                    detailsTab === 'details' ? 'bg-accent/80 text-text' : 'text-muted'
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsTab('timeline')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                    detailsTab === 'timeline' ? 'bg-accent/80 text-text' : 'text-muted'
                  }`}
                >
                  Timeline
                </button>
              </div>

              {detailsTab === 'details' ? (
                <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Project Name:</span>{' '}
                    {selectedRequest.projectName}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Requested By Name:</span>{' '}
                    {selectedRequest.requestedByName}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Status:</span>{' '}
                    {formatStatusLabel(selectedRequest.status)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Created At:</span>{' '}
                    {formatDateTime(selectedRequest.createdAt)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Updated At:</span>{' '}
                    {formatDateTime(selectedRequest.updatedAt)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Estimate No:</span>{' '}
                    {selectedRequest.estimateNumber || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Estimate Amount:</span>{' '}
                    {formatAmount(selectedRequest.estimateAmount)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Sales Order Number:</span>{' '}
                    {selectedRequest.salesOrderNumber || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Sales Order Amount:</span>{' '}
                    {formatAmount(selectedRequest.salesOrderAmount)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Sales Order date:</span>{' '}
                    {formatDate(selectedRequest.salesOrderDate)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Approved By:</span>{' '}
                    {selectedRequest.approval?.approvedByName || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Rejection Reason:</span>{' '}
                    {selectedRequest.approval?.rejectionReason || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Store Handoff:</span>{' '}
                    {formatStoreHandoffStatus(selectedRequest)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Handed Off At:</span>{' '}
                    {formatDateTime(selectedRequest.handedOffAt)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Handed Off By:</span>{' '}
                    {selectedRequest.handedOffByName || '-'}
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-border/60 bg-bg/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-semibold text-text">Timeline</p>
                    <button
                      type="button"
                      onClick={() => setIsTimelineOpen((prev) => !prev)}
                      className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 md:hidden"
                    >
                      {isTimelineOpen ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div
                    className={`mt-5 max-h-[360px] space-y-5 overflow-y-auto pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
                      isTimelineOpen ? 'block' : 'hidden'
                    } md:block`}
                  >
                    {isLoadingTimeline ? (
                      <p className="text-sm text-muted">Loading activity...</p>
                    ) : timelineActivities.length === 0 ? (
                      <p className="text-sm text-muted">
                        No Store interaction logged yet for this Sales Order.
                      </p>
                    ) : (
                      timelineActivities.map((activity, index) => (
                        <div key={`${activity.id}-${index}`} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <span className={`h-3 w-3 rounded-full ${activityDotClass(activity)}`} />
                            {index < timelineActivities.length - 1 ? (
                              <span className="mt-2 h-10 w-[1px] bg-border/60" />
                            ) : null}
                          </div>
                          <div>
                            <p className="font-semibold text-text">{activity.note || 'Activity update'}</p>
                            <p className="mt-1 text-sm text-muted">
                              {formatTimelineDate(activity.date)} -{' '}
                              {activity.actorName || activity.createdBy || 'System'}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {selectedRequest.status === 'pending_approval' && canApprove ? (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openRejectModal(selectedRequest)}
                    disabled={isSaving === selectedRequest.id}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(selectedRequest)}
                    disabled={isSaving === selectedRequest.id}
                    className="rounded-full border border-border/60 bg-emerald-500/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving === selectedRequest.id ? 'Saving...' : 'Approve'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {rejectRequest ? (
          <div
            data-modal-overlay="true"
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
            onClick={() => {
              setRejectRequest(null);
              setRejectReason('');
            }}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-border/60 bg-surface p-4 shadow-soft"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                    Reject request
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-text">{rejectRequest.requestNo}</h3>
                  <p className="mt-1 text-sm text-muted">{rejectRequest.projectName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRejectRequest(null);
                    setRejectReason('');
                  }}
                  className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted hover:text-text"
                >
                  Close
                </button>
              </div>
              <form className="mt-4 space-y-3" onSubmit={handleRejectSubmit}>
                <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  Rejection reason
                </label>
                <textarea
                  required
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Provide reason for rejecting this Sales Order Req..."
                  className="min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectRequest(null);
                      setRejectReason('');
                    }}
                    className="rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving === rejectRequest.id}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving === rejectRequest.id ? 'Rejecting...' : 'Reject'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
