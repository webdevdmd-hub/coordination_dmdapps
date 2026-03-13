'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseCustomerRepository } from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { Customer, CustomerStatus } from '@/core/entities/customer';
import { User } from '@/core/entities/user';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import {
  filterUsersByRole,
  hasRoleScope,
} from '@/lib/roleVisibility';

type CustomerFormState = {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  source: string;
  status: CustomerStatus;
  assignedTo: string;
  sharedRoles: string[];
};

const statusOptions: Array<{ value: CustomerStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const statusStyles: Record<CustomerStatus, string> = {
  active: 'bg-[#00B67A]/20 text-[#00B67A]',
  inactive: 'bg-surface-strong text-text',
  new: 'bg-[#00B67A]/16 text-[#00B67A]',
  contacted: 'bg-sky-200 text-sky-900',
  proposal: 'bg-amber-200 text-amber-900',
  negotiation: 'bg-violet-200 text-violet-900',
  won: 'bg-[#00B67A]/20 text-[#00B67A]',
  lost: 'bg-rose-500/20 text-rose-200',
};

export default function Page() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'customer_view']);
  const canViewAllCustomers =
    !!user && hasPermission(user.permissions, ['admin', 'customer_view_all']);
  const canViewSameRoleCustomers =
    !!user && hasRoleScope(user.permissions, 'customer_view_same_role');
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'customer_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'customer_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'customer_delete']);
  const canAssign = !!user && hasPermission(user.permissions, ['admin', 'customer_assign']);
  const canOpenDetails = canEdit || canDelete;

  const emptyCustomer = (assignedTo: string): CustomerFormState => ({
    companyName: '',
    contactPerson: '',
    email: '',
    phone: '',
    source: '',
    status: 'active',
    assignedTo,
    sharedRoles: [],
  });

  const [formState, setFormState] = useState<CustomerFormState>(() =>
    emptyCustomer(user?.id ?? ''),
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

  const visibleUsers = useMemo(
    () => filterUsersByRole(user, users, 'customers', user?.roleRelations),
    [user, users],
  );

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    visibleUsers.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllCustomers && !canViewSameRoleCustomers) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [canViewAllCustomers, canViewSameRoleCustomers, user, visibleUsers]);

  const visibleUserIds = useMemo(() => {
    const ids = new Set<string>(visibleUsers.map((profile) => profile.id));
    if (user) {
      ids.add(user.id);
    }
    return ids;
  }, [visibleUsers, user]);

  const assignableUsers = useMemo(() => {
    return filterAssignableUsers(users, roles, 'customer_assign', {
      currentUser: user,
      moduleKey: 'customers',
    });
  }, [users, roles, user]);

  useEffect(() => {
    if (!user || !(canViewAllCustomers || canViewSameRoleCustomers || canAssign)) {
      setUsers([]);
      setRoles([]);
      return;
    }
    const loadUsers = async () => {
      try {
        const [result, roleSummaries] = await Promise.all([
          firebaseUserRepository.listAll(),
          fetchRoleSummaries(),
        ]);
        setUsers(result);
        setRoles(roleSummaries);
      } catch {
        setUsers([]);
        setRoles([]);
      }
    };
    loadUsers();
  }, [user, canViewAllCustomers, canViewSameRoleCustomers, canAssign]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!canViewAllCustomers && !canViewSameRoleCustomers) {
      setOwnerFilter(user.id);
    }
  }, [user, canViewAllCustomers, canViewSameRoleCustomers]);

  useEffect(() => {
    const loadCustomers = async () => {
      if (!user) {
        setCustomers([]);
        setLoading(false);
        return;
      }
      if (!canView) {
        setCustomers([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (canViewAllCustomers) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          if (ownerFilter === 'all') {
            setCustomers(allCustomers);
            return;
          }
          const selectedRole = userRoleMap.get(ownerFilter);
          const filtered = allCustomers.filter(
            (customer) =>
              customer.assignedTo === ownerFilter ||
              (selectedRole ? customer.sharedRoles.includes(selectedRole) : false),
          );
          setCustomers(filtered);
          return;
        }
        if (canViewSameRoleCustomers) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          const sameRoleCustomers = allCustomers.filter((customer) =>
            visibleUserIds.has(customer.assignedTo),
          );
          if (ownerFilter === 'all') {
            setCustomers(sameRoleCustomers);
            return;
          }
          const selectedRole = userRoleMap.get(ownerFilter);
          const filtered = sameRoleCustomers.filter(
            (customer) =>
              customer.assignedTo === ownerFilter ||
              (selectedRole ? customer.sharedRoles.includes(selectedRole) : false),
          );
          setCustomers(filtered);
          return;
        }
        const result = await firebaseCustomerRepository.listForUser(user.id, user.role);
        setCustomers(result);
      } catch {
        setError('Unable to load customers. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadCustomers();
  }, [
    user,
    canView,
    canViewAllCustomers,
    canViewSameRoleCustomers,
    ownerFilter,
    userRoleMap,
    visibleUserIds,
  ]);

  const totals = useMemo(() => {
    const active = customers.filter((customer) => customer.status === 'active').length;
    const fresh = customers.filter((customer) => customer.status === 'new').length;
    const won = customers.filter((customer) => customer.status === 'won').length;
    return { active, fresh, won };
  }, [customers]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesStatus = statusFilter === 'all' ? true : customer.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [customer.companyName, customer.contactPerson, customer.email].some((value) =>
          value.toLowerCase().includes(term),
        );
      return matchesStatus && matchesSearch;
    });
  }, [customers, statusFilter, search]);

  const getOwnerInitials = (ownerId: string) => {
    const name = ownerNameMap.get(ownerId) ?? ownerId;
    return name
      .split(' ')
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  const customerViewOptions: Array<'list' | 'cards'> = ['list', 'cards'];
  const selectedCustomerViewIndex = Math.max(0, customerViewOptions.indexOf(viewMode));
  const customerStatusFilterOptions = ['all', ...statusOptions.map((option) => option.value)] as const;
  const selectedCustomerStatusIndex = Math.max(
    0,
    customerStatusFilterOptions.indexOf(statusFilter),
  );

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedCustomer(null);
    setFormState(emptyCustomer(user.id));
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormState({
      companyName: customer.companyName,
      contactPerson: customer.contactPerson,
      email: customer.email,
      phone: customer.phone,
      source: customer.source,
      status: customer.status,
      assignedTo: customer.assignedTo,
      sharedRoles: customer.sharedRoles ?? [],
    });
    setIsEditOpen(true);
  };

  const handleEntryOpen = (customer: Customer) => {
    if (!canOpenDetails) {
      return;
    }
    handleOpenEdit(customer);
  };

  const handleEntryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, customer: Customer) => {
    if (!canOpenDetails) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenEdit(customer);
    }
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save customers.');
      return;
    }
    if (!formState.companyName.trim() || !formState.contactPerson.trim() || !formState.email) {
      setError('Company, contact, and email are required.');
      return;
    }
    const isEditing = !!selectedCustomer;
    if (isEditing && !canEdit) {
      setError('You do not have permission to edit customers.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create customers.');
      return;
    }
    if (isEditing && !isAdmin && selectedCustomer?.assignedTo !== user.id) {
      setError('You can only edit customers assigned to you.');
      return;
    }

    const updates = {
      ...formState,
      companyName: formState.companyName.trim(),
      contactPerson: formState.contactPerson.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      source: formState.source.trim(),
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && selectedCustomer) {
        const updated = await firebaseCustomerRepository.update(selectedCustomer.id, {
          ...updates,
          updatedAt: new Date().toISOString(),
        });
        setCustomers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await firebaseCustomerRepository.create({
          ...updates,
          createdBy: user.id,
        });
        setCustomers((prev) => [created, ...prev]);
      }
      handleCloseModal();
    } catch {
      setError('Unable to save customer. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCustomer) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete customers.');
      return;
    }
    if (!canDelete) {
      setError('You do not have permission to delete customers.');
      return;
    }
    if (!isAdmin && selectedCustomer.assignedTo !== user.id) {
      setError('You can only delete customers assigned to you.');
      return;
    }
    const confirmed = window.confirm('Delete this customer? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseCustomerRepository.delete(selectedCustomer.id);
      setCustomers((prev) => prev.filter((item) => item.id !== selectedCustomer.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete customer. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleQuickStatusChange = async (customer: Customer, nextStatus: CustomerStatus) => {
    if (!user || !canEdit) {
      return;
    }
    if (!isAdmin && customer.assignedTo !== user.id) {
      return;
    }
    try {
      const updated = await firebaseCustomerRepository.update(customer.id, {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      setCustomers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setError('Unable to update customer status.');
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Customers
            </p>
            <h1 className="font-display text-5xl text-text">Post-win records</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Won leads live here. Quotation requests and invoices attach to customer accounts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-3 text-xs text-muted">
              <label htmlFor="customer-owner" className="sr-only">
                Owner
              </label>
              <select
                id="customer-owner"
                name="customer-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllCustomers && !canViewSameRoleCustomers}
                className="bg-transparent text-sm font-semibold uppercase tracking-[0.14em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative grid grid-cols-2 rounded-2xl border border-border bg-surface p-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-text shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out"
                style={{
                  width: 'calc((100% - 1rem) / 2)',
                  transform: `translateX(calc(${selectedCustomerViewIndex} * 100%))`,
                }}
              />
              {customerViewOptions.map((layout) => (
                <button
                  key={layout}
                  type="button"
                  onClick={() => setViewMode(layout)}
                  className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                    viewMode === layout ? 'text-white' : 'text-muted hover:text-text'
                  }`}
                >
                  {layout}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="rounded-2xl border border-[#00B67A]/30 bg-[#00B67A] px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(0,182,122,0.22)] transition hover:-translate-y-[1px] hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              New customer
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Active</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.active}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">New</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.fresh}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Won</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totals.won}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border bg-surface p-6 shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-2 text-xs text-muted sm:w-auto sm:min-w-[260px]">
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
                placeholder="Search customers"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70"
              />
            </div>
            <div className="relative w-full rounded-2xl border border-border bg-[var(--surface-muted)] p-1 sm:w-auto">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${customerStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedCustomerStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${customerStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {customerStatusFilterOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                      statusFilter === status ? 'text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {status === 'all'
                      ? 'All'
                      : statusOptions.find((option) => option.value === status)?.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-2xl border border-border bg-surface px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:-translate-y-[1px] hover:bg-[var(--surface-soft)]"
          >
            Export list
          </button>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            You do not have permission to view customers.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            Loading customers...
          </div>
        ) : viewMode === 'list' ? (
          <div className="mt-6 space-y-4">
            <div className="overflow-hidden rounded-3xl border border-border bg-surface">
              {filtered.map((customer) => (
                <div
                  key={customer.id}
                  role={canOpenDetails ? 'button' : undefined}
                  tabIndex={canOpenDetails ? 0 : -1}
                  onClick={() => handleEntryOpen(customer)}
                  onKeyDown={(event) => handleEntryKeyDown(event, customer)}
                  aria-disabled={!canOpenDetails}
                  className={`grid gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_1.2fr_1fr_1fr_1fr_0.9fr_auto] md:items-center md:gap-2 md:px-4 ${
                    canOpenDetails ? 'cursor-pointer transition hover:bg-[var(--surface-soft)]' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-[var(--surface-muted)] text-[11px] font-semibold uppercase tracking-[0.12em] text-text">
                      {getOwnerInitials(customer.assignedTo)}
                    </span>
                    <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-text">
                      {ownerNameMap.get(customer.assignedTo) ?? customer.assignedTo}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-text">{customer.contactPerson}</p>
                    <p className="truncate text-xs text-muted">{customer.email}</p>
                  </div>

                  <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                    {customer.companyName}
                  </p>

                  <p className="truncate text-sm text-text">{customer.source || '-'}</p>

                  <div>
                    <select
                      value={customer.status}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        handleQuickStatusChange(customer, event.target.value as CustomerStatus)
                      }
                      disabled={!canEdit || (!isAdmin && customer.assignedTo !== user?.id)}
                      className="w-full rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span
                    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                      statusStyles[customer.status]
                    }`}
                  >
                    {statusOptions.find((option) => option.value === customer.status)?.label ?? customer.status}
                  </span>

                  {canEdit ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenEdit(customer);
                      }}
                      className="rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {filtered.map((customer) => (
              <div
                key={customer.id}
                role={canOpenDetails ? 'button' : undefined}
                tabIndex={canOpenDetails ? 0 : -1}
                onClick={() => handleEntryOpen(customer)}
                onKeyDown={(event) => handleEntryKeyDown(event, customer)}
                aria-disabled={!canOpenDetails}
                className={`rounded-3xl border border-border bg-surface p-4 shadow-soft ${
                  canOpenDetails ? 'cursor-pointer transition hover:-translate-y-[1px] hover:border-border/80' : ''
                }`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/80">
                      {customer.companyName}
                    </p>
                    <h2 className="mt-1 font-display text-lg text-text">{customer.contactPerson}</h2>
                    <div className="mt-1 space-y-1 text-[11px] text-muted">
                      <p className="truncate">{customer.email}</p>
                      <p>
                        Owner{' '}
                        <span className="font-semibold text-text">
                          {ownerNameMap.get(customer.assignedTo) ?? customer.assignedTo}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                        statusStyles[customer.status]
                      }`}
                    >
                      {statusOptions.find((option) => option.value === customer.status)?.label ?? customer.status}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      {customer.source || 'No source'}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : '-'}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 grid w-full grid-cols-3 divide-x divide-border py-0.5 text-center">
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Owner</p>
                    <p className="mt-1 text-sm font-semibold text-text">{getOwnerInitials(customer.assignedTo)}</p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Status</p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      {statusOptions.find((option) => option.value === customer.status)?.label ?? customer.status}
                    </p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Shared</p>
                    <p className="mt-1 text-sm font-semibold text-text">{customer.sharedRoles.length}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenEdit(customer);
                      }}
                      className="rounded-xl bg-[#00B67A]/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#00B67A]"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {canCreate ? (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="rounded-3xl border-2 border-dashed border-border bg-[var(--surface-soft)] p-8 text-center transition hover:bg-[var(--surface-muted)]"
              >
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-muted)] text-4xl text-muted">
                  +
                </div>
                <p className="mt-6 text-sm font-semibold uppercase tracking-[0.24em] text-muted/80">
                  New contact
                </p>
              </button>
            ) : null}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            No customers found yet.
          </div>
        ) : null}
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
                  {selectedCustomer ? 'Edit customer' : 'New customer'}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Capture customer details and keep the account moving forward.
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
                    Company name
                  </label>
                  <input
                    required
                    value={formState.companyName}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, companyName: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Contact person
                  </label>
                  <input
                    required
                    value={formState.contactPerson}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, contactPerson: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={formState.email}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, email: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Phone
                  </label>
                  <input
                    value={formState.phone}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Source
                  </label>
                  <input
                    value={formState.source}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, source: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
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
                        status: event.target.value as CustomerStatus,
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
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Assigned to
                  </label>
                  {canAssign ? (
                    <select
                      value={formState.assignedTo}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, assignedTo: event.target.value }))
                      }
                      disabled={!canAssign}
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                    >
                      {!canAssign ? (
                        <option value={formState.assignedTo}>
                          {ownerNameMap.get(formState.assignedTo) ?? formState.assignedTo}
                        </option>
                      ) : assignableUsers.length === 0 ? (
                        <option value="" disabled>
                          No eligible assignees
                        </option>
                      ) : (
                        assignableUsers.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.fullName}
                          </option>
                        ))
                      )}
                    </select>
                  ) : (
                    <input
                      value={ownerNameMap.get(formState.assignedTo) ?? formState.assignedTo}
                      readOnly
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted"
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {selectedCustomer && canDelete ? (
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
                  {isSaving ? 'Saving...' : selectedCustomer ? 'Save customer' : 'Create customer'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      )}
    </div>
  );
}








