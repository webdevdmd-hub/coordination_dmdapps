'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

import { firebaseSalesOrderRequestRepository } from '@/adapters/repositories/firebaseSalesOrderRequestRepository';
import { useAuth } from '@/components/auth/AuthProvider';
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
  const storeStatusFilterOptions = ['all', 'pending', 'received'] as const;
  const selectedStoreStatusIndex = Math.max(0, storeStatusFilterOptions.indexOf(statusFilter));

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">Operations</p>
            <h1 className="font-display text-5xl text-text">Store</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Sales Order Reqs sent by Accounts appear here for Store processing.
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Queue</p>
          <p className="mt-2 text-sm text-muted">Requests: {totals.count}</p>
          <p className="text-sm text-muted">Pending Receive: {totals.pending}</p>
          <p className="text-sm text-muted">Received: {totals.received}</p>
          <p className="text-sm text-muted">Sales Order Amount: {formatAmount(totals.amount)}</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-surface/80 p-4">
          <div className="relative w-full rounded-2xl border border-border bg-[var(--surface-muted)] p-1 md:w-auto">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
              style={{
                width: `calc((100% - 0.5rem) / ${storeStatusFilterOptions.length})`,
                transform: `translateX(calc(${selectedStoreStatusIndex} * 100%))`,
              }}
            />
            <div
              className="relative z-[1] grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${storeStatusFilterOptions.length}, minmax(0, 1fr))`,
              }}
            >
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                  statusFilter === 'all' ? 'text-white' : 'text-muted hover:text-text'
                }`}
              >
                All ({totals.count})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('pending')}
                className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                  statusFilter === 'pending' ? 'text-white' : 'text-muted hover:text-text'
                }`}
              >
                Pending ({totals.pending})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('received')}
                className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                  statusFilter === 'received' ? 'text-white' : 'text-muted hover:text-text'
                }`}
              >
                Received ({totals.received})
              </button>
            </div>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredRequests.map((request) => (
              <section
                key={request.id}
                className="lift-hover rounded-xl border border-border/60 bg-surface/80 p-3 shadow-soft"
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
                      ? 'bg-[#00B67A]/15 text-[#00B67A]'
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
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleMarkAsReceived(request)}
                    disabled={isSaving === request.id}
                    className="rounded-full border border-border/60 bg-[#00B67A] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving === request.id ? 'Saving...' : 'Receive'}
                  </button>
                </div>
              ) : null}
              </section>
            ))}
          </div>
        )}

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
