'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

import { firebaseSalesOrderRequestRepository } from '@/adapters/repositories/firebaseSalesOrderRequestRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleShell } from '@/components/ui/ModuleShell';
import { SalesOrderRequest } from '@/core/entities/salesOrderRequest';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { hasPermission } from '@/lib/permissions';
import { addSalesOrderTimelineEvent } from '@/lib/salesOrderTimeline';

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

const formatAmount = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

const logStoreReceivedActivity = async (
  request: SalesOrderRequest,
  actorId: string,
  actorName: string,
) => {
  const now = new Date().toISOString();
  await Promise.all([
    addDoc(collection(getFirebaseDb(), 'sales', 'main', 'projects', request.projectId, 'activities'), {
      type: 'note',
      note: `Sales Order Req ${request.requestNo} marked as received by Store (${actorName}).`,
      date: now,
      createdBy: actorId,
    }),
    addSalesOrderTimelineEvent({
      requestId: request.id,
      requestNo: request.requestNo,
      projectId: request.projectId,
      type: 'store_received',
      note: `Sales Order Req ${request.requestNo} marked as received by Store (${actorName}).`,
      actorId,
      actorName,
      date: now,
    }),
  ]);
};

export default function Page() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SalesOrderRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'received'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canView = !!user && hasPermission(user.permissions, ['admin', 'store']);

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
        const all = await firebaseSalesOrderRequestRepository.listAll();
        if (!active) {
          return;
        }
        const sent = all
          .filter(
            (item) =>
              item.status === 'approved' &&
              (item.handoffToStore === 'queued' || item.handoffToStore === 'received'),
          )
          .sort((a, b) => {
            const aTime = itemTime(a);
            const bTime = itemTime(b);
            return bTime.localeCompare(aTime);
          });
        setRequests(sent);
      } catch {
        if (active) {
          setError('Unable to load Store handoff requests.');
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

  const itemTime = (item: SalesOrderRequest) => item.handedOffAt || item.updatedAt;

  const isReceived = (item: SalesOrderRequest) =>
    item.handoffToStore === 'received' || !!item.storeReceived;

  const handleMarkAsReceived = async (request: SalesOrderRequest) => {
    if (!user || !canView || isReceived(request)) {
      return;
    }
    setIsSaving(request.id);
    setError(null);
    const now = new Date().toISOString();
    try {
      const updated = await firebaseSalesOrderRequestRepository.update(request.id, {
        handoffToStore: 'received',
        storeReceived: true,
        storeReceivedAt: now,
        storeReceivedBy: user.id,
        storeReceivedByName: user.fullName,
        updatedAt: now,
      });
      setRequests((prev) => prev.map((item) => (item.id === request.id ? updated : item)));
      await Promise.allSettled([logStoreReceivedActivity(request, user.id, user.fullName)]);
    } catch {
      setError('Unable to mark request as received.');
    } finally {
      setIsSaving(null);
    }
  };

  const totals = useMemo(
    () => ({
      count: requests.length,
      amount: requests.reduce((sum, item) => sum + (item.salesOrderAmount || 0), 0),
      pending: requests.filter((item) => !isReceived(item)).length,
      received: requests.filter((item) => isReceived(item)).length,
    }),
    [requests],
  );

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') {
      return requests;
    }
    if (statusFilter === 'pending') {
      return requests.filter((item) => !isReceived(item));
    }
    return requests.filter((item) => isReceived(item));
  }, [requests, statusFilter]);

  return (
    <ModuleShell
      title="Store"
      description="Sales Order Reqs sent by Accounts appear here for Store processing."
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Queue</p>
          <p className="mt-2 text-sm text-muted">Requests: {totals.count}</p>
          <p className="text-sm text-muted">Pending Receive: {totals.pending}</p>
          <p className="text-sm text-muted">Received: {totals.received}</p>
          <p className="text-sm text-muted">Sales Order Amount: {formatAmount(totals.amount)}</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                statusFilter === 'all'
                  ? 'bg-accent/80 text-text'
                  : 'border border-border/60 bg-bg/70 text-muted'
              }`}
            >
              All ({totals.count})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                statusFilter === 'pending'
                  ? 'bg-accent/80 text-text'
                  : 'border border-border/60 bg-bg/70 text-muted'
              }`}
            >
              Pending ({totals.pending})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('received')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                statusFilter === 'received'
                  ? 'bg-accent/80 text-text'
                  : 'border border-border/60 bg-bg/70 text-muted'
              }`}
            >
              Received ({totals.received})
            </button>
          </div>
        </div>

        {!canView ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            You do not have permission to view Store requests.
          </div>
        ) : isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            Loading Store requests...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
            No Store requests found for this filter.
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
                  <p className="mt-1 text-sm text-muted">Customer: {request.customerName || '-'}</p>
                </div>
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                    isReceived(request)
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : 'bg-blue-500/15 text-blue-200'
                  }`}
                >
                  {isReceived(request) ? 'Received' : 'Queued'}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Sales Order Number:</span> {request.salesOrderNumber || '-'}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Sales Order Amount:</span>{' '}
                  {formatAmount(request.salesOrderAmount)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Handed Off At:</span>{' '}
                  {formatDateTime(request.handedOffAt)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Handed Off By:</span>{' '}
                  {request.handedOffByName || '-'}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Received At:</span>{' '}
                  {formatDateTime(request.storeReceivedAt)}
                </p>
                <p className="rounded-xl border border-border/50 bg-bg/60 px-3 py-2 text-muted">
                  <span className="font-semibold text-text">Received By:</span>{' '}
                  {request.storeReceivedByName || '-'}
                </p>
              </div>
              {!isReceived(request) ? (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleMarkAsReceived(request)}
                    disabled={isSaving === request.id}
                    className="rounded-full border border-border/60 bg-emerald-500/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving === request.id ? 'Saving...' : 'Receive'}
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
