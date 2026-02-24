'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseCalendarRepository } from '@/adapters/repositories/firebaseCalendarRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { CalendarEvent } from '@/core/entities/calendarEvent';
import { Lead } from '@/core/entities/lead';
import { User } from '@/core/entities/user';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';

const statusOrder: Array<{ key: Lead['status']; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

const categoryPalette = ['#0EA5E9', '#6366F1', '#22C55E', '#F59E0B', '#EC4899'];

const toMonthKey = (value?: string) => (value ? value.slice(0, 7) : '');

const toMonthInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const uniqueCount = (values: string[]) => new Set(values.filter(Boolean)).size;

export default function Page() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState(() => toMonthInput(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!user?.permissions.includes('admin');
  const canViewLeads = !!user && hasPermission(user.permissions, ['admin', 'lead_view']);
  const canViewCalendar = !!user && hasPermission(user.permissions, ['admin', 'calendar_view']);

  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!isAdmin) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [isAdmin, user, users]);

  useEffect(() => {
    if (!user || !isAdmin) {
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
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!isAdmin) {
      setOwnerFilter(user.id);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLeads([]);
        setEvents([]);
        setLoading(false);
        return;
      }
      if (!canViewLeads && !canViewCalendar) {
        setLeads([]);
        setEvents([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const useAll = isAdmin && ownerFilter === 'all';
        const leadPromise = canViewLeads
          ? useAll
            ? firebaseLeadRepository.listAll()
            : firebaseLeadRepository.listByOwner(ownerFilter === 'all' ? user.id : ownerFilter)
          : Promise.resolve([] as Lead[]);
        const eventPromise = canViewCalendar
          ? useAll
            ? firebaseCalendarRepository.listAll()
            : firebaseCalendarRepository.listByOwner(ownerFilter === 'all' ? user.id : ownerFilter)
          : Promise.resolve([] as CalendarEvent[]);

        const [leadResult, eventResult] = await Promise.all([leadPromise, eventPromise]);
        setLeads(leadResult);
        setEvents(eventResult);
      } catch {
        setError('Unable to load CRM reports. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user, isAdmin, ownerFilter, canViewLeads, canViewCalendar]);

  const filteredLeads = useMemo(() => {
    if (!monthFilter) {
      return leads;
    }
    return leads.filter((lead) => toMonthKey(lead.createdAt) === monthFilter);
  }, [leads, monthFilter]);

  const filteredEvents = useMemo(() => {
    if (!monthFilter) {
      return events;
    }
    return events.filter((eventItem) => toMonthKey(eventItem.startDate) === monthFilter);
  }, [events, monthFilter]);

  const metrics = useMemo(() => {
    const totalLeads = filteredLeads.length;
    const activeLeads = filteredLeads.filter(
      (lead) => lead.status !== 'won' && lead.status !== 'lost',
    );
    const wonLeads = filteredLeads.filter((lead) => lead.status === 'won');
    const lostLeads = filteredLeads.filter((lead) => lead.status === 'lost');
    const revenueWon = wonLeads.reduce((sum, lead) => sum + (lead.value || 0), 0);
    const pipelineValue = filteredLeads.reduce((sum, lead) => sum + (lead.value || 0), 0);
    const conversionBase = wonLeads.length + lostLeads.length;
    const conversionRate = conversionBase > 0 ? (wonLeads.length / conversionBase) * 100 : 0;
    const customers = uniqueCount(filteredLeads.map((lead) => lead.company));
    const activeCustomers = uniqueCount(activeLeads.map((lead) => lead.company));

    return {
      totalLeads,
      activeLeads: activeLeads.length,
      wonLeads: wonLeads.length,
      lostLeads: lostLeads.length,
      revenueWon,
      pipelineValue,
      conversionRate,
      customers,
      activeCustomers,
    };
  }, [filteredLeads]);

  const statusBreakdown = useMemo(() => {
    return statusOrder.map((status) => ({
      label: status.label,
      value: filteredLeads.filter((lead) => lead.status === status.key).length,
    }));
  }, [filteredLeads]);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredLeads.forEach((lead) => {
      const key = lead.source || 'Unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [filteredLeads]);

  const eventSummary = useMemo(() => {
    const tasks = filteredEvents.filter((eventItem) => eventItem.type === 'task');
    const eventsOnly = filteredEvents.filter((eventItem) => eventItem.type === 'event');
    return {
      total: filteredEvents.length,
      tasks: tasks.length,
      events: eventsOnly.length,
    };
  }, [filteredEvents]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredEvents.forEach((eventItem) => {
      map.set(eventItem.category, (map.get(eventItem.category) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [filteredEvents]);

  const topOwners = useMemo(() => {
    const map = new Map<string, number>();
    filteredLeads.forEach((lead) => {
      map.set(lead.ownerId, (map.get(lead.ownerId) ?? 0) + 1);
    });
    const rows = Array.from(map.entries()).map(([id, count]) => ({
      id,
      name: ownerNameMap.get(id) ?? id,
      count,
    }));
    return rows.sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredLeads, ownerNameMap]);

  const maxBar = useMemo(() => {
    const values = [...statusBreakdown, ...sourceBreakdown, ...categoryBreakdown].map(
      (item) => item.value,
    );
    return Math.max(...values, 1);
  }, [statusBreakdown, sourceBreakdown, categoryBreakdown]);

  const canRender = canViewLeads || canViewCalendar;

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              CRM Reports
            </p>
            <h1 className="font-display text-3xl text-text">Revenue intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Track conversion, pipeline, and customer momentum across every assigned lead and
              scheduled task.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted">
              <label htmlFor="reports-owner" className="sr-only">
                Owner
              </label>
              <select
                id="reports-owner"
                name="reports-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!isAdmin}
                className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted">
              <label htmlFor="reports-month" className="sr-only">
                Month
              </label>
              <input
                type="month"
                id="reports-month"
                name="reports-month"
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
                className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none"
              />
            </div>
          </div>
        </div>

        {!canRender ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            You do not have permission to view CRM reports.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            Loading reports...
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
                Total leads
              </p>
              <p className="mt-3 text-2xl font-semibold text-text">{metrics.totalLeads}</p>
              <p className="mt-1 text-xs text-muted">{metrics.activeLeads} active</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
                Conversion rate
              </p>
              <p className="mt-3 text-2xl font-semibold text-text">
                {metrics.conversionRate.toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-muted">
                {metrics.wonLeads} won / {metrics.lostLeads} lost
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
                Revenue won
              </p>
              <p className="mt-3 text-2xl font-semibold text-text">
                {formatCurrency(metrics.revenueWon)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Pipeline {formatCurrency(metrics.pipelineValue)}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
                Customers
              </p>
              <p className="mt-3 text-2xl font-semibold text-text">{metrics.customers}</p>
              <p className="mt-1 text-xs text-muted">{metrics.activeCustomers} active</p>
            </div>
          </div>
        )}
      </section>

      {canRender && !loading ? (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Pipeline health
            </p>
            <h2 className="mt-2 font-display text-2xl text-text">Leads by status</h2>
            <div className="mt-6 space-y-4">
              {statusBreakdown.map((item, index) => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="uppercase tracking-[0.18em]">{item.label}</span>
                    <span>{item.value}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-bg/70">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${(item.value / maxBar) * 100}%`,
                        backgroundColor: categoryPalette[index % categoryPalette.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Activity volume
            </p>
            <h2 className="mt-2 font-display text-2xl text-text">Calendar coverage</h2>
            <div className="mt-6 space-y-4 text-sm text-text">
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Total calendar items
                </p>
                <p className="mt-2 text-2xl font-semibold text-text">{eventSummary.total}</p>
                <p className="mt-1 text-xs text-muted">{eventSummary.events} events</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Task load
                </p>
                <p className="mt-2 text-2xl font-semibold text-text">{eventSummary.tasks}</p>
                <p className="mt-1 text-xs text-muted">Tasks scheduled this month</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Top owners
                </p>
                <div className="mt-3 space-y-2 text-xs text-muted">
                  {topOwners.length === 0 ? (
                    <p>No owners yet.</p>
                  ) : (
                    topOwners.map((owner, index) => (
                      <div
                        key={`${owner.id || owner.name}-${index}`}
                        className="flex items-center justify-between"
                      >
                        <span>{owner.name}</span>
                        <span className="text-text">{owner.count} leads</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {canRender && !loading ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Lead sources
            </p>
            <h2 className="mt-2 font-display text-2xl text-text">Attribution</h2>
            <div className="mt-6 space-y-4">
              {sourceBreakdown.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                  No sources tracked for this period.
                </div>
              ) : (
                sourceBreakdown.map((item, index) => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="uppercase tracking-[0.18em]">{item.label}</span>
                      <span>{item.value}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-bg/70">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${(item.value / maxBar) * 100}%`,
                          backgroundColor: categoryPalette[index % categoryPalette.length],
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Calendar categories
            </p>
            <h2 className="mt-2 font-display text-2xl text-text">Tasks by category</h2>
            <div className="mt-6 space-y-4">
              {categoryBreakdown.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                  No calendar items logged for this period.
                </div>
              ) : (
                categoryBreakdown.map((item, index) => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="uppercase tracking-[0.18em]">
                        {item.label.replace('_', ' ')}
                      </span>
                      <span>{item.value}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-bg/70">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${(item.value / maxBar) * 100}%`,
                          backgroundColor: categoryPalette[index % categoryPalette.length],
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
    </div>
  );
}
