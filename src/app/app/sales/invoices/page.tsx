'use client';

import { useMemo, useState } from 'react';

import { formatCurrency } from '@/lib/currency';

type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

type Invoice = {
  id: string;
  customer: string;
  owner: string;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
};

const mockInvoices: Invoice[] = [
  {
    id: 'inv-001',
    customer: 'Prairie Foods',
    owner: 'You',
    amount: 82000,
    status: 'sent',
    issuedAt: '2026-01-14',
    dueAt: '2026-02-01',
  },
  {
    id: 'inv-002',
    customer: 'Evergreen Health',
    owner: 'Jordan',
    amount: 64000,
    status: 'paid',
    issuedAt: '2026-01-05',
    dueAt: '2026-01-25',
  },
  {
    id: 'inv-003',
    customer: 'Northbound Logistics',
    owner: 'Maya',
    amount: 56000,
    status: 'overdue',
    issuedAt: '2025-12-20',
    dueAt: '2026-01-10',
  },
];

const statusStyles: Record<InvoiceStatus, string> = {
  draft: 'bg-surface-strong text-text',
  sent: 'bg-accent/70 text-text',
  paid: 'bg-emerald-200 text-emerald-900',
  overdue: 'bg-amber-200 text-amber-800',
};

export default function Page() {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const totals = useMemo(() => {
    const draft = mockInvoices.filter((i) => i.status === 'draft').length;
    const sent = mockInvoices.filter((i) => i.status === 'sent').length;
    const paid = mockInvoices.filter((i) => i.status === 'paid').length;
    const overdue = mockInvoices.filter((i) => i.status === 'overdue').length;
    return { draft, sent, paid, overdue };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return mockInvoices.filter((invoice) => {
      const matchesStatus = statusFilter === 'all' ? true : invoice.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [invoice.customer, invoice.owner].some((value) => value.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [statusFilter, search]);
  const invoiceStatusFilterOptions = ['all', 'draft', 'sent', 'paid', 'overdue'] as const;
  const selectedInvoiceStatusIndex = Math.max(
    0,
    invoiceStatusFilterOptions.indexOf(statusFilter),
  );

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">Invoices</p>
            <h1 className="font-display text-5xl text-text">Billing pipeline</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Approved quotations move into invoicing. Track payments and overdue activity here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
            >
              New invoice
            </button>
            <button
              type="button"
              className="rounded-full border border-border/60 bg-surface/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:-translate-y-[1px] hover:bg-hover/80"
            >
              Export ledger
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Drafts</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.draft}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Sent</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.sent}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Paid</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.paid}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Overdue</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.overdue}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted">
              <span>?</span>
              <input
                type="search"
                placeholder="Search invoices"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-48 bg-transparent text-sm text-text outline-none placeholder:text-muted/70"
              />
            </div>
            <div className="relative w-full rounded-2xl border border-border bg-[var(--surface-muted)] p-1 md:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${invoiceStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedInvoiceStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${invoiceStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {invoiceStatusFilterOptions.map((status) => (
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
          <button
            type="button"
            className="rounded-full border border-border/60 bg-surface/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:-translate-y-[1px] hover:bg-hover/80"
          >
            Aging view
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {filtered.map((invoice) => (
            <div key={invoice.id} className="rounded-2xl border border-border/60 bg-bg/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    {invoice.customer}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-text">
                    Invoice owner: {invoice.owner}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Amount: {formatCurrency(invoice.amount)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      statusStyles[invoice.status]
                    }`}
                  >
                    {invoice.status}
                  </span>
                  <span className="rounded-full border border-border/60 bg-surface/80 px-3 py-1 text-xs text-muted">
                    Due: {invoice.dueAt}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-hover/80"
                  >
                    View
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
          Finance policy
        </p>
        <h2 className="mt-2 font-display text-2xl text-text">Collections rhythm</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Overdue invoices trigger escalation after seven days. Automated reminders are scheduled
          for due-date minus 3 days.
        </p>
      </section>
    </div>
  );
}
