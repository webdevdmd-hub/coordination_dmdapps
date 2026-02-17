'use client';

import { useMemo } from 'react';

import { leads } from '@/data/mock/leads';
import { formatCurrency } from '@/lib/currency';

export default function Page() {
  const totals = useMemo(() => {
    const won = leads.filter((lead) => lead.status === 'won').length;
    const revenue = leads
      .filter((lead) => lead.status === 'won')
      .reduce((sum, lead) => sum + lead.value, 0);
    return { won, revenue };
  }, []);

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Sales</p>
            <h1 className="font-display text-3xl text-text">Revenue momentum</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
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
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Won customers
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{totals.won}</p>
            <p className="mt-1 text-xs text-muted">Active in Sales</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Revenue pipeline
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">
              {formatCurrency(totals.revenue)}
            </p>
            <p className="mt-1 text-xs text-muted">Won opportunities</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Quote velocity
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">5.1 days</p>
            <p className="mt-1 text-xs text-muted">Average to issue quote</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
          <h2 className="font-display text-2xl text-text">Active customers</h2>
          <div className="mt-6 space-y-3 text-sm text-text">
            {[
              'Prairie Foods - Quotation requested',
              'Evergreen Health - Preparing proposal',
              'Northbound Logistics - Awaiting scope confirmation',
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-border/60 bg-bg/70 p-3">
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-surface via-surface-strong/60 to-accent/40 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
            Quotation pulse
          </p>
          <h2 className="mt-2 font-display text-2xl text-text">Quote readiness</h2>
          <div className="mt-6 space-y-3 text-sm text-text">
            {[
              '2 quotations pending approval',
              '1 invoice ready to issue',
              '3 customer projects awaiting kickoff',
            ].map((item) => (
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
