'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, getDocs } from 'firebase/firestore';

import { firebasePurchaseOrderRequestRepository } from '@/adapters/repositories/firebasePurchaseOrderRequestRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleShell } from '@/components/ui/ModuleShell';
import { PurchaseOrderRequest, PurchaseOrderRequestStatus } from '@/core/entities/purchaseOrderRequest';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { emitNotificationEventSafe } from '@/lib/notifications';
import { hasPermission } from '@/lib/permissions';

type SalesOrderActivity = {
  id: string;
  note: string;
  date: string;
  createdBy: string;
  type?: string;
};

const statusChipStyles: Record<PurchaseOrderRequestStatus, string> = {
  draft: 'bg-surface-strong text-text',
  pending_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-200 text-emerald-900',
  rejected: 'bg-rose-200 text-rose-900',
  cancelled: 'bg-slate-300 text-slate-800',
};

const formatStatusLabel = (value: PurchaseOrderRequestStatus) =>
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

const activityDotClass = (activity: SalesOrderActivity) => {
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
  request: PurchaseOrderRequest,
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

const notifyRequester = async (
  request: PurchaseOrderRequest,
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
    type: status === 'approved' ? 'po_request.approved' : 'po_request.rejected',
    title: status === 'approved' ? 'Sales Order Req Approved' : 'Sales Order Req Rejected',
    body,
    actorId,
    recipients: [request.requestedBy],
    entityType: 'purchaseOrderRequest',
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
  const [requests, setRequests] = useState<PurchaseOrderRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderRequestStatus | 'all'>(
    'pending_approval',
  );
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [selectedRequest, setSelectedRequest] = useState<PurchaseOrderRequest | null>(null);
  const [detailsTab, setDetailsTab] = useState<'details' | 'timeline'>('details');
  const [timelineActivities, setTimelineActivities] = useState<SalesOrderActivity[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canView = !!user &&
    hasPermission(user.permissions, ['admin', 'sales_order_request_view', 'po_request_view']);
  const canApprove = !!user &&
    hasPermission(user.permissions, [
      'admin',
      'sales_order_request_approve',
      'po_request_approve',
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
        const result = await firebasePurchaseOrderRequestRepository.listAll();
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
        const snapshot = await getDocs(
          collection(
            getFirebaseDb(),
            'sales',
            'main',
            'projects',
            selectedRequest.projectId,
            'activities',
          ),
        );
        if (!active) {
          return;
        }
        const items = snapshot.docs
          .map((docItem) => ({
            id: docItem.id,
            ...(docItem.data() as Omit<SalesOrderActivity, 'id'>),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
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

  const applyStatusUpdate = async (
    request: PurchaseOrderRequest,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ) => {
    if (!user || !canApprove) {
      return;
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

    try {
      const updated = await firebasePurchaseOrderRequestRepository.update(request.id, {
        status,
        approval,
        updatedAt: now,
      });
      setRequests((prev) => prev.map((item) => (item.id === request.id ? updated : item)));
      setSelectedRequest((prev) => (prev?.id === request.id ? updated : prev));
      await Promise.allSettled([
        logPoDecisionActivity(request, user.id, status, rejectionReason),
        notifyRequester(request, user.id, user.fullName, status, rejectionReason),
      ]);
    } catch {
      setError('Unable to update Sales Order Req status.');
    } finally {
      setIsSaving(null);
    }
  };

  const handleApprove = async (request: PurchaseOrderRequest) => {
    await applyStatusUpdate(request, 'approved');
  };

  const handleReject = async (request: PurchaseOrderRequest) => {
    const reason = window.prompt('Enter rejection reason');
    if (reason === null) {
      return;
    }
    if (!reason.trim()) {
      setError('Rejection reason is required.');
      return;
    }
    await applyStatusUpdate(request, 'rejected', reason.trim());
  };

  const openRequestDetails = (request: PurchaseOrderRequest, tab: 'details' | 'timeline') => {
    setSelectedRequest(request);
    setDetailsTab(tab);
    setIsTimelineOpen(false);
  };

  return (
    <ModuleShell
      title="Sales Order"
      description="Review Sales Order Reqs and complete approval decisions."
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter('pending_approval')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                  statusFilter === 'pending_approval'
                    ? 'bg-accent/80 text-text'
                    : 'border border-border/60 bg-bg/70 text-muted'
                }`}
              >
                Pending ({totals.pending})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('approved')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                  statusFilter === 'approved'
                    ? 'bg-accent/80 text-text'
                    : 'border border-border/60 bg-bg/70 text-muted'
                }`}
              >
                Approved ({totals.approved})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('rejected')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                  statusFilter === 'rejected'
                    ? 'bg-accent/80 text-text'
                    : 'border border-border/60 bg-bg/70 text-muted'
                }`}
              >
                Rejected ({totals.rejected})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                  statusFilter === 'all'
                    ? 'bg-accent/80 text-text'
                    : 'border border-border/60 bg-bg/70 text-muted'
                }`}
              >
                All ({requests.length})
              </button>
            </div>
            <div className="inline-flex rounded-full border border-border/60 bg-bg/70 p-1">
              <button
                type="button"
                onClick={() => setViewMode('card')}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${
                  viewMode === 'card' ? 'bg-accent/80 text-text' : 'text-muted'
                }`}
              >
                Card View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${
                  viewMode === 'list' ? 'bg-accent/80 text-text' : 'text-muted'
                }`}
              >
                List View
              </button>
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
                              handleReject(request);
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
                    <span className="font-semibold text-text">PO Number:</span>{' '}
                    {selectedRequest.poNumber || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">PO Amount:</span>{' '}
                    {formatAmount(selectedRequest.poAmount)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Date of the PO:</span>{' '}
                    {formatDate(selectedRequest.poDate)}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Approved By:</span>{' '}
                    {selectedRequest.approval?.approvedByName || '-'}
                  </p>
                  <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                    <span className="font-semibold text-text">Rejection Reason:</span>{' '}
                    {selectedRequest.approval?.rejectionReason || '-'}
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
                      <p className="text-sm text-muted">No activity logged yet.</p>
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
                              {formatTimelineDate(activity.date)} - {activity.createdBy || 'System'}
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
                    onClick={() => handleReject(selectedRequest)}
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
      </div>
    </ModuleShell>
  );
}
