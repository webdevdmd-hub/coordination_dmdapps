'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

import { firebasePurchaseOrderRequestRepository } from '@/adapters/repositories/firebasePurchaseOrderRequestRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleShell } from '@/components/ui/ModuleShell';
import {
  PurchaseOrderRequest,
  PurchaseOrderRequestStatus,
} from '@/core/entities/purchaseOrderRequest';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { emitNotificationEventSafe } from '@/lib/notifications';
import { hasPermission } from '@/lib/permissions';

const statusStyles: Record<PurchaseOrderRequestStatus, string> = {
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

const formatDate = (value?: string) => {
  if (!value) {
    return '-';
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString();
};

const formatAmount = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

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

  return (
    <ModuleShell
      title="Sales Order"
      description="Review Sales Order Reqs and complete approval decisions."
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
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
          filteredRequests.map((request) => (
            <section
              key={request.id}
              className="rounded-2xl border border-border/60 bg-surface/80 p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                    Req no: {request.requestNo}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-text">{request.projectName}</h3>
                  <p className="mt-1 text-sm text-muted">
                    Requested by: {request.requestedByName}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusStyles[request.status]}`}
                  >
                    {formatStatusLabel(request.status)}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Project Name:</span> {request.projectName}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Requested By Name:</span>{' '}
                  {request.requestedByName}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Status:</span> {request.status}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Created At:</span>{' '}
                  {formatDateTime(request.createdAt)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Updated At:</span>{' '}
                  {formatDateTime(request.updatedAt)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Estimate No:</span>{' '}
                  {request.estimateNumber || '-'}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Estimate Amount:</span>{' '}
                  {formatAmount(request.estimateAmount)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">PO Number:</span> {request.poNumber || '-'}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">PO Amount:</span>{' '}
                  {formatAmount(request.poAmount)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Date of the PO:</span>{' '}
                  {formatDate(request.poDate)}
                </p>
              </div>

              {request.status === 'pending_approval' && canApprove ? (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleReject(request)}
                    disabled={isSaving === request.id}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApprove(request)}
                    disabled={isSaving === request.id}
                    className="rounded-full border border-border/60 bg-emerald-500/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving === request.id ? 'Saving...' : 'Approve'}
                  </button>
                </div>
              ) : null}
            </section>
          ))
        )}

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
      </div>
    </ModuleShell>
  );
}
