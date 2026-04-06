'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { Lead } from '@/core/entities/lead';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';

const statusLabel = (status: Lead['status']) =>
  status.replace(/\b\w/g, (value) => value.toUpperCase());

export default function Page() {
  const { user, permissions, loading: authLoading } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!permissions.includes('admin');
  const canViewLeads = hasPermission(permissions, ['admin', 'lead_view']);

  useEffect(() => {
    let active = true;

    const loadLeads = async () => {
      if (authLoading) {
        return;
      }

      if (!user || !canViewLeads) {
        if (active) {
          setLeads([]);
          setError(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = isAdmin
          ? await firebaseLeadRepository.listAll()
          : await firebaseLeadRepository.listByOwner(user.id);
        if (active) {
          setLeads(result);
        }
      } catch {
        if (active) {
          setError('Unable to load sales lead data. Please try again.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadLeads();

    return () => {
      active = false;
    };
  }, [authLoading, canViewLeads, isAdmin, user]);

  const totals = useMemo(() => {
    const wonLeads = leads.filter((lead) => lead.status === 'won');
    const pipelineLeads = leads.filter((lead) => !['won', 'lost'].includes(lead.status));
    const revenue = wonLeads.reduce((sum, lead) => sum + (lead.value || 0), 0);
    const pipelineValue = pipelineLeads.reduce((sum, lead) => sum + (lead.value || 0), 0);

    return {
      won: wonLeads.length,
      revenue,
      pipelineValue,
    };
  }, [leads]);

  const activeCustomers = useMemo(
    () =>
      leads
        .filter((lead) => lead.status !== 'lost')
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        .slice(0, 3),
    [leads],
  );

  const quoteReadiness = useMemo(() => {
    const ready = leads.filter((lead) => ['proposal', 'negotiation'].includes(lead.status)).length;
    const approvals = leads.filter((lead) => lead.status === 'won').length;
    const followUps = leads.filter((lead) => lead.status === 'contacted').length;

    return [
      `${ready} leads preparing quotes`,
      `${approvals} converted to customers`,
      `${followUps} awaiting next follow-up`,
    ];
  }, [leads]);

  if (authLoading || loading) {
    return (
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-sm text-muted">Loading sales data...</p>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">Sales</p>
            <h1 className="font-display text-5xl text-text">Revenue momentum</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Conversions flow in from CRM once a lead is approved. Track the revenue impact and
              quote throughput here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
            >
              New quotation
            </button>
            <button
              type="button"
              className="rounded-full border border-border/60 bg-surface/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:-translate-y-[1px] hover:bg-hover/80"
            >
              Export sales
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Won customers
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.won}</p>
            <p className="mt-1 text-xs text-muted">Converted from CRM</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Revenue closed
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">
              {formatCurrency(totals.revenue)}
            </p>
            <p className="mt-1 text-xs text-muted">Won opportunities</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
              Open pipeline
            </p>
            <p className="mt-4 text-5xl font-semibold text-text">
              {formatCurrency(totals.pipelineValue)}
            </p>
            <p className="mt-1 text-xs text-muted">Active lead value</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!canViewLeads ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          You do not have permission to view CRM leads, so sales metrics cannot be loaded.
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
          <h2 className="font-display text-2xl text-text">Active customers</h2>
          <div className="mt-6 space-y-3 text-sm text-text">
            {activeCustomers.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-3 text-muted">
                No lead-driven customer activity yet.
              </div>
            ) : (
              activeCustomers.map((lead) => (
                <div key={lead.id} className="rounded-2xl border border-border/60 bg-bg/70 p-3">
                  <p className="font-semibold text-text">{lead.company}</p>
                  <p className="mt-1 text-xs text-muted">
                    {lead.name} | {statusLabel(lead.status)} | {formatCurrency(lead.value || 0)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-surface via-surface-strong/60 to-accent/40 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
            Quotation pulse
          </p>
          <h2 className="mt-2 font-display text-2xl text-text">Quote readiness</h2>
          <div className="mt-6 space-y-3 text-sm text-text">
            {quoteReadiness.map((item) => (
              <div key={item} className="rounded-2xl border border-border/60 bg-bg/70 p-3">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Guidance</p>
        <h2 className="mt-2 font-display text-2xl text-text">Sales workflow</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Quotation requests unlock only after CRM conversion. Track customer status and move
          projects forward.
        </p>
      </section>
    </div>
  );
}
