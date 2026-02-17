'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseCustomerRepository } from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseQuotationRepository } from '@/adapters/repositories/firebaseQuotationRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { Customer } from '@/core/entities/customer';
import { Quotation, QuotationLineItem, QuotationStatus } from '@/core/entities/quotation';
import { User } from '@/core/entities/user';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';

const statusOptions: Array<{ value: QuotationStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
];

const statusStyles: Record<QuotationStatus, string> = {
  draft: 'bg-surface-strong text-text',
  sent: 'bg-accent/70 text-text',
  approved: 'bg-emerald-200 text-emerald-900',
};

type QuotationFormState = {
  quoteNumber: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  status: QuotationStatus;
  lineItems: QuotationLineItem[];
  notes: string;
  taxRate: number;
  assignedTo: string;
  sharedRoles: string[];
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const formatDate = (value: string) => {
  if (!value) {
    return '-';
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const createLineItem = (): QuotationLineItem => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  description: '',
  quantity: 1,
  unitPrice: 0,
});

const generateQuoteNumber = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(100 + Math.random() * 900);
  return `QT-${year}${month}-${random}`;
};

const calculateTotals = (items: QuotationLineItem[], taxRate: number) => {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const safeTax = Number.isFinite(taxRate) ? taxRate : 0;
  const taxAmount = subtotal * (safeTax / 100);
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total, taxRate: safeTax };
};

export default function Page() {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'quotation_view']);
  const canViewAllQuotations =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_view_all']);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'quotation_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'quotation_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'quotation_delete']);
  const canViewAllCustomers =
    !!user && hasPermission(user.permissions, ['admin', 'customer_view_all']);

  const emptyQuotation = (assignedTo: string): QuotationFormState => ({
    quoteNumber: generateQuoteNumber(new Date()),
    validUntil: todayKey(),
    customerId: '',
    customerName: '',
    status: 'draft',
    lineItems: [createLineItem()],
    notes: '',
    taxRate: 5,
    assignedTo,
    sharedRoles: [],
  });

  const [formState, setFormState] = useState<QuotationFormState>(() =>
    emptyQuotation(user?.id ?? ''),
  );

  const totals = useMemo(
    () => calculateTotals(formState.lineItems, formState.taxRate),
    [formState.lineItems, formState.taxRate],
  );
  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const userRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((profile) => map.set(profile.id, profile.role));
    if (user) {
      map.set(user.id, user.role);
    }
    return map;
  }, [user, users]);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllQuotations) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [canViewAllQuotations, user, users]);

  useEffect(() => {
    if (!user || !canViewAllQuotations) {
      setUsers([]);
      return;
    }
    const loadUsers = async () => {
      try {
        const result = await firebaseUserRepository.listAll();
        setUsers(result);
      } catch {
        setUsers([]);
      }
    };
    loadUsers();
  }, [user, canViewAllQuotations]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!canViewAllQuotations) {
      setOwnerFilter(user.id);
    }
  }, [user, canViewAllQuotations]);

  useEffect(() => {
    const loadCustomers = async () => {
      if (!user) {
        setCustomers([]);
        return;
      }
      try {
        if (canViewAllCustomers || isAdmin) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          setCustomers(allCustomers);
          return;
        }
        const result = await firebaseCustomerRepository.listForUser(user.id, user.role);
        setCustomers(result);
      } catch {
        setCustomers([]);
      }
    };
    loadCustomers();
  }, [user, isAdmin, canViewAllCustomers]);

  useEffect(() => {
    const loadQuotations = async () => {
      if (!user) {
        setQuotations([]);
        setLoading(false);
        return;
      }
      if (!canView) {
        setQuotations([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (canViewAllQuotations) {
          const allQuotes = await firebaseQuotationRepository.listAll();
          if (ownerFilter === 'all') {
            setQuotations(allQuotes);
            return;
          }
          const selectedRole = userRoleMap.get(ownerFilter);
          const filtered = allQuotes.filter(
            (quote) =>
              quote.assignedTo === ownerFilter ||
              (selectedRole ? quote.sharedRoles.includes(selectedRole) : false),
          );
          setQuotations(filtered);
          return;
        }
        const result = await firebaseQuotationRepository.listForUser(user.id, user.role);
        setQuotations(result);
      } catch {
        setError('Unable to load quotations. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadQuotations();
  }, [user, canView, canViewAllQuotations, ownerFilter, userRoleMap]);

  const filteredQuotations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotations.filter((quote) => {
      const matchesStatus = statusFilter === 'all' ? true : quote.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [quote.customerName, quote.quoteNumber].some((value) => value.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [quotations, search, statusFilter]);

  const totalsByStatus = useMemo(() => {
    const draft = quotations.filter((quote) => quote.status === 'draft').length;
    const sent = quotations.filter((quote) => quote.status === 'sent').length;
    const approved = quotations.filter((quote) => quote.status === 'approved').length;
    return { draft, sent, approved };
  }, [quotations]);

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedQuotation(null);
    setFormState(emptyQuotation(user.id));
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (quote: Quotation) => {
    setSelectedQuotation(quote);
    setFormState({
      quoteNumber: quote.quoteNumber,
      validUntil: quote.validUntil,
      customerId: quote.customerId,
      customerName: quote.customerName,
      status: quote.status,
      lineItems: quote.lineItems.length ? quote.lineItems : [createLineItem()],
      notes: quote.notes,
      taxRate: quote.taxRate ?? 0,
      assignedTo: quote.assignedTo,
      sharedRoles: quote.sharedRoles ?? [],
    });
    setIsEditOpen(true);
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
  };

  const handleSelectCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) {
      return;
    }
    setFormState((prev) => ({
      ...prev,
      customerId: customer.id,
      customerName: customer.companyName,
      assignedTo: customer.assignedTo,
      sharedRoles: customer.sharedRoles ?? [],
    }));
  };

  const handleAddLineItem = () => {
    setFormState((prev) => ({
      ...prev,
      lineItems: [...prev.lineItems, createLineItem()],
    }));
  };

  const handleRemoveLineItem = (id: string) => {
    setFormState((prev) => {
      const next = prev.lineItems.filter((item) => item.id !== id);
      return { ...prev, lineItems: next.length ? next : [createLineItem()] };
    });
  };

  const handleLineItemChange = (
    id: string,
    field: keyof Pick<QuotationLineItem, 'description' | 'quantity' | 'unitPrice'>,
    value: string,
  ) => {
    setFormState((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === 'description'
                  ? value
                  : Number.isFinite(Number(value))
                    ? Number(value)
                    : 0,
            }
          : item,
      ),
    }));
  };
  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save quotations.');
      return;
    }
    if (!formState.customerId || !formState.validUntil) {
      setError('Customer and valid until date are required.');
      return;
    }
    const isEditing = !!selectedQuotation;
    if (isEditing && !canEdit) {
      setError('You do not have permission to edit quotations.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create quotations.');
      return;
    }
    if (isEditing && !isAdmin && selectedQuotation?.assignedTo !== user.id) {
      setError('You can only edit quotations assigned to you.');
      return;
    }

    const { subtotal, taxAmount, total, taxRate } = calculateTotals(
      formState.lineItems,
      formState.taxRate,
    );

    const updates = {
      ...formState,
      notes: formState.notes.trim(),
      lineItems: formState.lineItems.map((item) => ({
        ...item,
        description: item.description.trim(),
      })),
      subtotal,
      taxAmount,
      total,
      taxRate,
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && selectedQuotation) {
        const updated = await firebaseQuotationRepository.update(selectedQuotation.id, {
          ...updates,
          updatedAt: new Date().toISOString(),
        });
        setQuotations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await firebaseQuotationRepository.create({
          ...updates,
          createdBy: user.id,
        });
        setQuotations((prev) => [created, ...prev]);
      }
      handleCloseModal();
    } catch {
      setError('Unable to save quotation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedQuotation) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete quotations.');
      return;
    }
    if (!canDelete) {
      setError('You do not have permission to delete quotations.');
      return;
    }
    if (!isAdmin && selectedQuotation.assignedTo !== user.id) {
      setError('You can only delete quotations assigned to you.');
      return;
    }
    const confirmed = window.confirm('Delete this quotation? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseQuotationRepository.delete(selectedQuotation.id);
      setQuotations((prev) => prev.filter((item) => item.id !== selectedQuotation.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete quotation. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Quotations
            </p>
            <h1 className="font-display text-3xl text-text">Quote management</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Create quotations with itemized pricing, tax, and approval tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted">
              <label htmlFor="quote-owner" className="sr-only">
                Owner
              </label>
              <select
                id="quote-owner"
                name="quote-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllQuotations}
                className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted">
              <label htmlFor="quote-view" className="sr-only">
                View
              </label>
              <select
                id="quote-view"
                name="quote-view"
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as 'list' | 'card')}
                className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none"
              >
                <option value="list">List</option>
                <option value="card">Card</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              New quotation
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">Draft</p>
            <p className="mt-3 text-2xl font-semibold text-text">{totalsByStatus.draft}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">Sent</p>
            <p className="mt-3 text-2xl font-semibold text-text">{totalsByStatus.sent}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">Approved</p>
            <p className="mt-3 text-2xl font-semibold text-text">{totalsByStatus.approved}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted md:w-auto md:rounded-full">
              <input
                type="search"
                placeholder="Search quotations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 md:w-48"
              />
            </div>
            <div className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-bg/70 p-2 md:w-auto md:flex md:flex-wrap md:items-center md:rounded-full md:p-1">
              {(['all', ...statusOptions.map((status) => status.value)] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`w-full rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition md:w-auto md:rounded-full ${
                    statusFilter === status
                      ? 'bg-accent/80 text-text'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {status === 'all'
                    ? 'All'
                    : statusOptions.find((option) => option.value === status)?.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted">{filteredQuotations.length} quotations</div>
        </div>
        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            You do not have permission to view quotations.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            Loading quotations...
          </div>
        ) : viewMode === 'card' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {filteredQuotations.map((quote) => (
              <div key={quote.id} className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      {quote.quoteNumber}
                    </p>
                    <h2 className="mt-2 font-display text-2xl text-text">{quote.customerName}</h2>
                    <p className="mt-2 text-sm text-muted">
                      Owner: {ownerNameMap.get(quote.assignedTo) ?? quote.assignedTo}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Valid until: {formatDate(quote.validUntil)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      statusStyles[quote.status]
                    }`}
                  >
                    {statusOptions.find((option) => option.value === quote.status)?.label}
                  </span>
                </div>
                <div className="mt-4 text-sm text-muted">Total: {formatCurrency(quote.total)}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(quote)}
                      className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:bg-hover/80"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border/60">
            <div className="hidden md:grid md:grid-cols-[1.1fr_1.4fr_1fr_1fr_0.8fr_0.8fr] gap-4 bg-surface-strong/60 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
              <span>Quote #</span>
              <span>Customer</span>
              <span>Valid until</span>
              <span>Total</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-border/60 bg-bg/60">
              {filteredQuotations.map((quote) => (
                <div
                  key={quote.id}
                  className="grid gap-3 px-5 py-4 text-sm text-text md:grid-cols-[1.1fr_1.4fr_1fr_1fr_0.8fr_0.8fr] md:gap-4"
                >
                  <div>
                    <p className="font-semibold">{quote.quoteNumber}</p>
                    <p className="mt-1 text-xs text-muted">
                      Owner: {ownerNameMap.get(quote.assignedTo) ?? quote.assignedTo}
                    </p>
                  </div>
                  <div>{quote.customerName}</div>
                  <div className="text-muted">{formatDate(quote.validUntil)}</div>
                  <div className="text-muted">{formatCurrency(quote.total)}</div>
                  <div>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                        statusStyles[quote.status]
                      }`}
                    >
                      {statusOptions.find((option) => option.value === quote.status)?.label}
                    </span>
                  </div>
                  <div className="flex md:justify-end">
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(quote)}
                          className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedQuotation(quote);
                            setIsEditOpen(true);
                          }}
                          className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              {filteredQuotations.length === 0 ? (
                <div className="px-5 py-6 text-sm text-muted">No quotations found yet.</div>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {(isCreateOpen || isEditOpen) && (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseModal}
        >
          <DraggablePanel
            className="w-full max-w-3xl rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl text-text">
                  {selectedQuotation ? 'Edit quotation' : 'New quotation'}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Build a quotation with line items, tax, and validity date.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleSave}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Quotation number
                  </label>
                  <input
                    value={formState.quoteNumber}
                    readOnly
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Valid until
                  </label>
                  <input
                    type="date"
                    required
                    value={formState.validUntil}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, validUntil: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Customer
                  </label>
                  <select
                    value={formState.customerId}
                    onChange={(event) => handleSelectCustomer(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    <option value="">Select customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.companyName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: event.target.value as QuotationStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Line items
                  </label>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-accent hover:text-accent-strong"
                  >
                    + Add line item
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {formState.lineItems.map((item) => (
                    <div key={item.id} className="grid gap-3 md:grid-cols-[2fr_0.6fr_0.8fr_auto]">
                      <input
                        placeholder="Description"
                        value={item.description}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'description', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'quantity', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <input
                        type="number"
                        min="0"
                        value={item.unitPrice}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'unitPrice', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(item.id)}
                        className="rounded-full border border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-muted">
                  <span>Tax</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={formState.taxRate}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          taxRate: Number(event.target.value),
                        }))
                      }
                      className="w-16 rounded-xl border border-border/60 bg-bg/70 px-2 py-1 text-sm text-text outline-none"
                    />
                    <span>%</span>
                    <span>{formatCurrency(totals.taxAmount)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-base font-semibold text-text">
                  <span>Total</span>
                  <span>{formatCurrency(totals.total)}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Notes
                </label>
                <textarea
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="Additional notes..."
                  className="mt-2 min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {selectedQuotation && canDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving
                    ? 'Saving...'
                    : selectedQuotation
                      ? 'Save quotation'
                      : 'Create quotation'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      )}
    </div>
  );
}
