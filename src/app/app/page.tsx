'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseCalendarRepository } from '@/adapters/repositories/firebaseCalendarRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseQuotationRepository } from '@/adapters/repositories/firebaseQuotationRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { CalendarEvent } from '@/core/entities/calendarEvent';
import { Lead } from '@/core/entities/lead';
import { Project } from '@/core/entities/project';
import { Quotation } from '@/core/entities/quotation';
import { Task } from '@/core/entities/task';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';

const todayKey = () => new Date().toISOString().slice(0, 10);

const formatShortDate = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isBeforeToday = (value?: string) => {
  if (!value) {
    return false;
  }
  const date = new Date(`${value}T00:00:00`);
  const today = new Date(`${todayKey()}T00:00:00`);
  return date < today;
};

export default function DashboardPage() {
  const { user, permissions } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  const isAdmin = !!permissions?.includes('admin');
  const canViewLeads = hasPermission(permissions ?? [], ['admin', 'lead_view']);
  const canViewTasks = hasPermission(permissions ?? [], ['admin', 'task_view']);
  const canViewProjects = hasPermission(permissions ?? [], ['admin', 'project_view']);
  const canViewQuotations = hasPermission(permissions ?? [], ['admin', 'quotation_view']);
  const canViewCalendar = hasPermission(permissions ?? [], ['admin', 'calendar_view']);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const [leadData, taskData, projectData, quotationData, calendarData] = await Promise.all([
          canViewLeads
            ? isAdmin
              ? firebaseLeadRepository.listAll()
              : firebaseLeadRepository.listByOwner(user.id)
            : Promise.resolve([] as Lead[]),
          canViewTasks
            ? isAdmin
              ? firebaseTaskRepository.listAll()
              : firebaseTaskRepository.listForUser(user.id, user.role)
            : Promise.resolve([] as Task[]),
          canViewProjects
            ? isAdmin
              ? firebaseProjectRepository.listAll()
              : firebaseProjectRepository.listForUser(user.id, user.role)
            : Promise.resolve([] as Project[]),
          canViewQuotations
            ? isAdmin
              ? firebaseQuotationRepository.listAll()
              : firebaseQuotationRepository.listForUser(user.id, user.role)
            : Promise.resolve([] as Quotation[]),
          canViewCalendar
            ? isAdmin
              ? firebaseCalendarRepository.listAll()
              : firebaseCalendarRepository.listByOwner(user.id)
            : Promise.resolve([] as CalendarEvent[]),
        ]);
        setLeads(leadData);
        setTasks(taskData);
        setProjects(projectData);
        setQuotations(quotationData);
        setCalendarEvents(calendarData);
      } catch {
        setError('Unable to load dashboard data. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [
    user,
    isAdmin,
    canViewLeads,
    canViewTasks,
    canViewProjects,
    canViewQuotations,
    canViewCalendar,
  ]);

  const metrics = useMemo(() => {
    const pipelineLeads = leads.filter((lead) => lead.status !== 'lost');
    const pipelineValue = pipelineLeads.reduce((sum, lead) => sum + (lead.value || 0), 0);
    const activeProjects = projects.filter((project) =>
      ['not-started', 'in-progress', 'on-hold'].includes(project.status),
    );
    const dueToday = tasks.filter((task) => task.dueDate === todayKey());
    const overdue = tasks.filter((task) => task.status !== 'done' && isBeforeToday(task.dueDate));
    return {
      pipelineValue,
      activeProjects: activeProjects.length,
      dueToday: dueToday.length,
      overdue: overdue.length,
    };
  }, [leads, projects, tasks]);

  const topLeads = useMemo(
    () =>
      [...leads]
        .filter((lead) => lead.status !== 'lost')
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, 5),
    [leads],
  );

  const overdueTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done' && isBeforeToday(task.dueDate)).slice(0, 5),
    [tasks],
  );

  const upcomingEvents = useMemo(() => {
    const today = todayKey();
    return calendarEvents
      .filter((event) => event.startDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 5);
  }, [calendarEvents]);

  const activeProjectList = useMemo(
    () =>
      projects
        .filter((project) => ['not-started', 'in-progress', 'on-hold'].includes(project.status))
        .slice(0, 5),
    [projects],
  );

  const recentQuotations = useMemo(() => [...quotations].slice(0, 4), [quotations]);

  if (loading) {
    return (
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-sm text-muted">Loading dashboard...</p>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] border border-border/60 bg-surface/80 p-6 shadow-floating">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
          Main Dashboard
        </p>
        <h1 className="font-display text-3xl text-text">Command center</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Track the pipeline, active work, and the next actions your team needs today.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Pipeline value
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">
              {formatCurrency(metrics.pipelineValue)}
            </p>
            <p className="mt-1 text-xs text-muted">{topLeads.length} top leads</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Active projects
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{metrics.activeProjects}</p>
            <p className="mt-1 text-xs text-muted">In-flight deliveries</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Tasks due today
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{metrics.dueToday}</p>
            <p className="mt-1 text-xs text-muted">Focus list</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Overdue tasks
            </p>
            <p className="mt-3 text-2xl font-semibold text-text">{metrics.overdue}</p>
            <p className="mt-1 text-xs text-muted">Immediate follow-up</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                Priority queue
              </p>
              <h2 className="font-display text-2xl text-text">Overdue tasks</h2>
            </div>
            <a
              href="/app/tasks"
              className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
            >
              View tasks
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {overdueTasks.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                No overdue tasks right now.
              </div>
            ) : (
              overdueTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/60 bg-bg/70 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-text">{task.title}</p>
                    <p className="mt-1 text-xs text-muted">Due {formatShortDate(task.dueDate)}</p>
                  </div>
                  <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-200">
                    Overdue
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
            Upcoming schedule
          </p>
          <h2 className="font-display text-2xl text-text">Next on deck</h2>
          <div className="mt-5 space-y-3">
            {upcomingEvents.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                No upcoming events.
              </div>
            ) : (
              upcomingEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-text"
                >
                  <p className="font-semibold">{event.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatShortDate(event.startDate)} • {event.category.replace('_', ' ')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                Pipeline focus
              </p>
              <h2 className="font-display text-2xl text-text">Top leads</h2>
            </div>
            <a
              href="/app/crm/leads"
              className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
            >
              View leads
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {topLeads.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                No leads available.
              </div>
            ) : (
              topLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/60 bg-bg/70 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-text">{lead.name}</p>
                    <p className="mt-1 text-xs text-muted">{lead.company}</p>
                  </div>
                  <span className="text-sm font-semibold text-text">
                    {formatCurrency(lead.value)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                Active delivery
              </p>
              <h2 className="font-display text-2xl text-text">Projects in motion</h2>
            </div>
            <a
              href="/app/sales/projects"
              className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
            >
              View projects
            </a>
          </div>
          <div className="mt-5 space-y-3">
            {activeProjectList.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                No active projects right now.
              </div>
            ) : (
              activeProjectList.map((project) => (
                <div
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/60 bg-bg/70 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-text">{project.name}</p>
                    <p className="mt-1 text-xs text-muted">{project.customerName}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                    {project.status.replace('-', ' ')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Quotations
            </p>
            <h2 className="font-display text-2xl text-text">Recent quotations</h2>
          </div>
          <a
            href="/app/sales/quotations"
            className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
          >
            View quotations
          </a>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {recentQuotations.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
              No quotations yet.
            </div>
          ) : (
            recentQuotations.map((quote) => (
              <div
                key={quote.id}
                className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-text"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                  {quote.quoteNumber}
                </p>
                <p className="mt-2 text-sm font-semibold text-text">{quote.customerName}</p>
                <p className="mt-1 text-xs text-muted">{quote.status}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
