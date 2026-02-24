'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import {
  firebaseLeadSourceRepository,
  LeadSource,
} from '@/adapters/repositories/firebaseLeadSourceRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { LeadModal } from '@/components/leads/LeadModal';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { useAuth } from '@/components/auth/AuthProvider';
import { Lead, LeadStatus } from '@/core/entities/lead';
import { User } from '@/core/entities/user';
import { createLead } from '@/core/use-cases/createLead';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';
import { buildRecipientList, emitNotificationEventSafe } from '@/lib/notifications';

const leadStatusClass: Record<LeadStatus, string> = {
  new: 'bg-[var(--surface-muted)] text-muted border border-border',
  contacted: 'bg-sky-500/10 text-sky-600 border border-sky-500/20',
  proposal: 'bg-amber-500/10 text-amber-700 border border-amber-500/20',
  negotiation: 'bg-violet-500/10 text-violet-700 border border-violet-500/20',
  won: 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/20',
  lost: 'bg-rose-500/10 text-rose-700 border border-rose-500/20',
};

const createLeadStatusOptions: Array<{ label: string; value: LeadStatus }> = [
  { label: 'New', value: 'new' },
  { label: 'Contacted', value: 'contacted' },
  { label: 'Proposal', value: 'proposal' },
  { label: 'Negotiation', value: 'negotiation' },
  { label: 'Won', value: 'won' },
  { label: 'Lost', value: 'lost' },
];

export default function Page() {
  const { user } = useAuth();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    value: '',
    source: '',
    status: 'new' as LeadStatus,
  });

  const defaultLeadSources = useMemo(
    () => ['Referral', 'Email Campaign', 'Website', 'Cold Call', 'Event', 'Partner'],
    [],
  );
  const canCreateLead = !!user && hasPermission(user.permissions, ['admin', 'lead_create']);
  const canViewLeads = !!user && hasPermission(user.permissions, ['admin', 'lead_view']);
  const canViewAllLeads = !!user && hasPermission(user.permissions, ['admin', 'lead_view_all']);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllLeads) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [user, users, canViewAllLeads]);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesDate = dateFilter ? lead.createdAt?.startsWith(dateFilter) : true;
      const matchesSearch =
        term.length === 0 ||
        [lead.name, lead.company, lead.email].some((value) => value.toLowerCase().includes(term));
      return matchesDate && matchesSearch;
    });
  }, [leads, search, dateFilter]);

  const leadSummary = useMemo(
    () => ({
      new: leads.filter((lead) => lead.status === 'new').length,
      proposal: leads.filter((lead) => lead.status === 'proposal').length,
      negotiation: leads.filter((lead) => lead.status === 'negotiation').length,
      won: leads.filter((lead) => lead.status === 'won').length,
    }),
    [leads],
  );

  const sourceOptions = useMemo(() => {
    const merged = new Set(defaultLeadSources);
    leadSources.forEach((source) => merged.add(source.name));
    return Array.from(merged);
  }, [defaultLeadSources, leadSources]);

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const getOwnerName = (ownerId: string) => ownerNameMap.get(ownerId) ?? ownerId;
  const getOwnerInitials = (ownerId: string) =>
    getOwnerName(ownerId)
      .split(' ')
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  useEffect(() => {
    const loadLeads = async () => {
      if (!user) {
        setLeads([]);
        setLoading(false);
        return;
      }
      if (!hasPermission(user.permissions, ['admin', 'lead_view'])) {
        setLeads([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const useAllLeads = canViewAllLeads && ownerFilter === 'all';
        const ownerId = ownerFilter === 'all' ? user.id : ownerFilter;
        const result = useAllLeads
          ? await firebaseLeadRepository.listAll()
          : await firebaseLeadRepository.listByOwner(ownerId);
        setLeads(result);
      } catch {
        setError('Unable to load leads. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadLeads();
  }, [user, ownerFilter, canViewAllLeads]);

  useEffect(() => {
    const loadSources = async () => {
      if (!user) {
        setLeadSources([]);
        return;
      }
      try {
        const result = await firebaseLeadSourceRepository.listAll();
        const canSeed = hasPermission(user.permissions, ['admin', 'lead_source_manage']);
        if (result.length === 0 && canSeed) {
          await Promise.all(
            defaultLeadSources.map((source) =>
              firebaseLeadSourceRepository.create(source, user.id),
            ),
          );
          const seeded = await firebaseLeadSourceRepository.listAll();
          setLeadSources(seeded);
          return;
        }
        if (canSeed) {
          const existing = new Set(result.map((source) => source.name.toLowerCase()));
          const missing = defaultLeadSources.filter(
            (source) => !existing.has(source.toLowerCase()),
          );
          if (missing.length > 0) {
            await Promise.all(
              missing.map((source) => firebaseLeadSourceRepository.create(source, user.id)),
            );
            const refreshed = await firebaseLeadSourceRepository.listAll();
            setLeadSources(refreshed);
            return;
          }
        }
        setLeadSources(result);
      } catch {
        setLeadSources([]);
      }
    };
    loadSources();
  }, [user, defaultLeadSources]);

  useEffect(() => {
    const loadUsers = async () => {
      if (!user) {
        setUsers([]);
        return;
      }
      if (!canViewAllLeads) {
        setUsers([]);
        return;
      }
      try {
        const result = await firebaseUserRepository.listAll();
        setUsers(result);
      } catch {
        setUsers([]);
      }
    };
    loadUsers();
  }, [user, canViewAllLeads]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!canViewAllLeads) {
      setOwnerFilter(user.id);
    }
  }, [user, canViewAllLeads]);

  const handleCreateLead = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to create a lead.');
      return;
    }
    if (!hasPermission(user.permissions, ['admin', 'lead_create'])) {
      setError('You do not have permission to create leads.');
      return;
    }
    if (!newLead.name.trim() || !newLead.company.trim() || !newLead.email.trim()) {
      setError('Name, company, and email are required.');
      return;
    }
    setError(null);
    setIsCreating(true);
    try {
      const created = await createLead(firebaseLeadRepository, {
        name: newLead.name.trim(),
        company: newLead.company.trim(),
        email: newLead.email.trim(),
        phone: newLead.phone.trim(),
        ownerId: user.id,
        status: newLead.status,
        value: Number(newLead.value) || 0,
        source: newLead.source.trim(),
        nextStep: '',
        activities: [],
      });
      setLeads((prev) => [created, ...prev]);
      setSearch('');
      setIsCreateOpen(false);
      setIsAddingSource(false);
      setNewSourceName('');
      setNewLead({
        name: '',
        company: '',
        email: '',
        phone: '',
        value: '',
        source: '',
        status: 'new',
      });
      const refreshed = await firebaseLeadRepository.listByOwner(user.id);
      setLeads(refreshed);
      await emitNotificationEventSafe({
        type: 'lead.created',
        title: 'New Lead Created',
        body: `${user.fullName} created lead ${created.name}.`,
        actorId: user.id,
        recipients: buildRecipientList(created.ownerId, [], user.id),
        entityType: 'lead',
        entityId: created.id,
        meta: {
          ownerId: created.ownerId,
          status: created.status,
        },
      });
    } catch {
      setError('Unable to create the lead. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateSource = async (name: string) => {
    if (!user) {
      setError('You must be signed in to add a source.');
      return null;
    }
    if (!hasPermission(user.permissions, ['admin', 'lead_source_manage'])) {
      setError('You do not have permission to add lead sources.');
      return null;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Source name is required.');
      return null;
    }
    const exists = leadSources.some(
      (source) => source.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      return trimmed;
    }
    try {
      const created = await firebaseLeadSourceRepository.create(trimmed, user.id);
      setLeadSources((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created.name;
    } catch {
      setError('Unable to add the lead source. Please try again.');
      return null;
    }
  };

  const handleUpdateLead = async (id: string, updates: Partial<Lead>) => {
    setError(null);
    if (!user) {
      setError('You must be signed in to update a lead.');
      return false;
    }
    if (!hasPermission(user.permissions, ['admin', 'lead_edit'])) {
      setError('You do not have permission to update leads.');
      return false;
    }
    if (!user.permissions.includes('admin')) {
      const target = leads.find((lead) => lead.id === id);
      if (target && target.ownerId !== user.id) {
        setError('You do not have permission to update this lead.');
        return false;
      }
    }
    try {
      const target = leads.find((lead) => lead.id === id);
      const updated = await firebaseLeadRepository.update(id, {
        ...updates,
        lastTouchedAt: new Date().toISOString(),
      });
      setLeads((prev) => prev.map((lead) => (lead.id === id ? updated : lead)));
      setSelectedLead(updated);
      if (target) {
        const changedFields = Object.keys(updates).filter((key) => {
          const typedKey = key as keyof Lead;
          return updates[typedKey] !== undefined && updates[typedKey] !== target[typedKey];
        });
        if (changedFields.length > 0) {
          await firebaseLeadRepository.addActivity(id, {
            type: 'note',
            note: `Lead updated: ${changedFields
              .map((field) => field.replace(/_/g, ' '))
              .join(', ')}`,
            date: new Date().toISOString(),
            createdBy: user.id,
          });
          await emitNotificationEventSafe({
            type: 'lead.updated',
            title: 'Lead Updated',
            body: `${user.fullName} updated ${updated.name}.`,
            actorId: user.id,
            recipients: buildRecipientList(updated.ownerId, [], user.id),
            entityType: 'lead',
            entityId: updated.id,
            meta: {
              status: updated.status,
              changedFields,
            },
          });
        }
      }
      return true;
    } catch {
      setError('Unable to update the lead. Please try again.');
      return false;
    }
  };

  const handleDeleteLead = async (id: string) => {
    setError(null);
    if (!user) {
      setError('You must be signed in to delete a lead.');
      return false;
    }
    if (!hasPermission(user.permissions, ['admin', 'lead_delete'])) {
      setError('You do not have permission to delete leads.');
      return false;
    }
    if (!user.permissions.includes('admin')) {
      const target = leads.find((lead) => lead.id === id);
      if (target && target.ownerId !== user.id) {
        setError('You do not have permission to delete this lead.');
        return false;
      }
    }
    try {
      await firebaseLeadRepository.delete(id);
      setLeads((prev) => prev.filter((lead) => lead.id !== id));
      if (selectedLead?.id === id) {
        setSelectedLead(null);
      }
      return true;
    } catch {
      setError('Unable to delete the lead. Please try again.');
      return false;
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">CRM</p>
            <h2 className="font-display text-5xl text-text">Leads</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-2xl border border-border bg-[var(--surface-muted)] p-1">
              {(['list', 'cards'] as const).map((layout) => (
                <button
                  key={layout}
                  type="button"
                  onClick={() => setView(layout)}
                  className={`rounded-xl px-6 py-2 text-sm font-semibold uppercase tracking-[0.14em] transition ${
                    view === layout ? 'bg-black text-white shadow-soft' : 'text-muted hover:text-text'
                  }`}
                >
                  {layout}
                </button>
              ))}
            </div>
            {canCreateLead ? (
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="rounded-2xl border border-accent/30 bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(6,151,107,0.22)] transition hover:-translate-y-[1px] hover:bg-accent-strong"
              >
                + New Lead
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">New leads</p>
            <p className="mt-4 text-5xl font-semibold text-text">{leadSummary.new}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Proposal</p>
            <p className="mt-4 text-5xl font-semibold text-text">{leadSummary.proposal}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Negotiation</p>
            <p className="mt-4 text-5xl font-semibold text-text">{leadSummary.negotiation}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Won</p>
            <p className="mt-4 text-5xl font-semibold text-text">{leadSummary.won}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
            </svg>
            <label htmlFor="lead-owner" className="sr-only">
              Owner
            </label>
            <select
              id="lead-owner"
              name="lead-owner"
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              disabled={!canViewAllLeads}
              className="w-full bg-transparent text-lg text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
            >
              {ownerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <label htmlFor="lead-date" className="sr-only">
              Date
            </label>
            <input
              type="date"
              id="lead-date"
              name="lead-date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="w-full bg-transparent text-lg text-text outline-none"
            />
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
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
            <label htmlFor="lead-search" className="sr-only">
              Search leads
            </label>
            <input
              type="search"
              id="lead-search"
              name="lead-search"
              placeholder="Search by name, company, email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-lg text-text outline-none placeholder:text-muted/70"
            />
          </div>
        </div>

        {!canViewLeads ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            You do not have permission to view leads.
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            Loading leads...
          </div>
        ) : (
          <>
            {view === 'list' ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-3xl border border-border bg-surface">
                  {filteredLeads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setSelectedLead(lead)}
                      className="grid w-full items-center gap-4 border-b border-border px-6 py-5 text-left transition hover:bg-[var(--surface-soft)] md:grid-cols-[2fr_1fr_1fr]"
                    >
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">
                          {lead.company}
                        </p>
                        <h3 className="mt-2 font-display text-4xl text-text">{lead.name}</h3>
                        <p className="mt-1 text-lg text-muted">{lead.email}</p>
                      </div>
                      <div className="space-y-2">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                            leadStatusClass[lead.status]
                          }`}
                        >
                          {lead.status}
                        </span>
                        <p className="text-xl font-semibold text-text">{formatCurrency(lead.value)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">Owner</p>
                        <div className="mt-2 flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-full border border-border bg-[var(--surface-muted)] text-xs font-semibold text-text">
                            {getOwnerInitials(lead.ownerId)}
                          </span>
                          <p className="text-lg text-text">{getOwnerName(lead.ownerId)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xl text-muted">
                  Showing {filteredLeads.length} of {leads.length} leads
                </p>
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedLead(lead)}
                    className="group relative rounded-3xl border border-border bg-surface p-6 text-left transition hover:-translate-y-[1px] hover:shadow-soft"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">{lead.company}</p>
                    <h3 className="mt-2 font-display text-5xl text-text">{lead.name}</h3>
                    <p className="mt-1 text-xl text-muted">{lead.email}</p>
                    <div className="mt-5 flex items-center gap-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                          leadStatusClass[lead.status]
                        }`}
                      >
                        {lead.status}
                      </span>
                      <p className="text-2xl font-semibold text-text">{formatCurrency(lead.value)}</p>
                    </div>
                    <div className="mt-6 border-t border-border pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted/80">Owner</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-full border border-border bg-[var(--surface-muted)] text-xs font-semibold text-text">
                            {getOwnerInitials(lead.ownerId)}
                          </span>
                          <p className="text-lg text-text">{getOwnerName(lead.ownerId)}</p>
                        </div>
                        <span className="rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                          View lead
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
                {canCreateLead ? (
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(true)}
                    className="rounded-3xl border-2 border-dashed border-border bg-[var(--surface-soft)] p-8 text-center transition hover:bg-[var(--surface-muted)]"
                  >
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-muted)] text-4xl text-muted">
                      +
                    </div>
                    <p className="mt-6 font-display text-4xl text-text">Add New Lead</p>
                    <p className="mt-2 text-lg text-muted">Click to expand your pipeline</p>
                  </button>
                ) : null}
              </div>
            )}

            {filteredLeads.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
                No leads match your current filters.
              </div>
            ) : null}
          </>
        )}
      </section>
      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      <LeadModal
        lead={selectedLead}
        sourceOptions={sourceOptions}
        canManageSources={
          !!user && hasPermission(user.permissions, ['admin', 'lead_source_manage'])
        }
        onCreateSource={handleCreateSource}
        ownerNameMap={Object.fromEntries(ownerNameMap.entries())}
        onClose={() => setSelectedLead(null)}
        onUpdate={handleUpdateLead}
        onDelete={handleDeleteLead}
        currentUserId={user?.id}
        canEdit={
          !!user &&
          hasPermission(user.permissions, ['admin', 'lead_edit']) &&
          (user.permissions.includes('admin') || selectedLead?.ownerId === user.id)
        }
        canDelete={
          !!user &&
          hasPermission(user.permissions, ['admin', 'lead_delete']) &&
          (user.permissions.includes('admin') || selectedLead?.ownerId === user.id)
        }
      />
      {isCreateOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => setIsCreateOpen(false)}
        >
          <DraggablePanel
            className="w-full max-w-2xl rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Create lead
                </p>
                <h3 className="font-display text-2xl text-text">New opportunity</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setIsAddingSource(false);
                  setNewSourceName('');
                }}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>
            <form className="mt-6 grid gap-4" onSubmit={handleCreateLead}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="lead-name"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Name
                  </label>
                  <input
                    id="lead-name"
                    name="lead-name"
                    required
                    value={newLead.name}
                    onChange={(event) =>
                      setNewLead((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lead-company"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Company
                  </label>
                  <input
                    id="lead-company"
                    name="lead-company"
                    required
                    value={newLead.company}
                    onChange={(event) =>
                      setNewLead((prev) => ({ ...prev, company: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lead-email"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Email
                  </label>
                  <input
                    id="lead-email"
                    name="lead-email"
                    required
                    type="email"
                    value={newLead.email}
                    onChange={(event) =>
                      setNewLead((prev) => ({ ...prev, email: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lead-phone"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Phone
                  </label>
                  <input
                    id="lead-phone"
                    name="lead-phone"
                    value={newLead.phone}
                    onChange={(event) =>
                      setNewLead((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="lead-status"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Status
                  </label>
                  <select
                    id="lead-status"
                    name="lead-status"
                    value={newLead.status}
                    onChange={(event) =>
                      setNewLead((prev) => ({
                        ...prev,
                        status: event.target.value as LeadStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    {createLeadStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="lead-value"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Value
                  </label>
                  <input
                    id="lead-value"
                    name="lead-value"
                    type="number"
                    value={newLead.value}
                    onChange={(event) =>
                      setNewLead((prev) => ({ ...prev, value: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lead-source"
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-muted"
                  >
                    Source
                  </label>
                  <select
                    id="lead-source"
                    name="lead-source"
                    value={newLead.source || ''}
                    onChange={(event) => {
                      if (event.target.value === '__new__') {
                        setNewLead((prev) => ({ ...prev, source: '' }));
                        setIsAddingSource(true);
                        return;
                      }
                      setIsAddingSource(false);
                      setNewLead((prev) => ({ ...prev, source: event.target.value }));
                    }}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    <option value="">Select source</option>
                    {sourceOptions.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                    {user && hasPermission(user.permissions, ['admin', 'lead_source_manage']) ? (
                      <option value="__new__">Add new source...</option>
                    ) : null}
                  </select>
                  {isAddingSource &&
                  user &&
                  hasPermission(user.permissions, ['admin', 'lead_source_manage']) ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={newSourceName}
                        onChange={(event) => setNewSourceName(event.target.value)}
                        placeholder="New source name"
                        className="w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const created = await handleCreateSource(newSourceName);
                          if (created) {
                            setNewLead((prev) => ({ ...prev, source: created }));
                            setNewSourceName('');
                            setIsAddingSource(false);
                          }
                        }}
                        className="rounded-full border border-border/60 bg-accent/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-text transition hover:bg-accent-strong/80"
                      >
                        Add
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreating ? 'Creating...' : 'Create lead'}
              </button>
            </form>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}
