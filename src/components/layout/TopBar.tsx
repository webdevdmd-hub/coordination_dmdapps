'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { firebaseCalendarRepository } from '@/adapters/repositories/firebaseCalendarRepository';
import { firebaseCustomerRepository } from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseQuotationRepository } from '@/adapters/repositories/firebaseQuotationRepository';
import { firebaseQuotationRequestRepository } from '@/adapters/repositories/firebaseQuotationRequestRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { CalendarEvent } from '@/core/entities/calendarEvent';
import { Customer } from '@/core/entities/customer';
import { Lead } from '@/core/entities/lead';
import { Project } from '@/core/entities/project';
import { Quotation } from '@/core/entities/quotation';
import { Task } from '@/core/entities/task';
import { hasPermission } from '@/lib/permissions';

type TopBarProps = {
  userName: string;
  roleLabel: string;
  onMenuClick: () => void;
  isMenuOpen: boolean;
  menuButtonRef?: React.RefObject<HTMLButtonElement | null>;
};

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  module: string;
  href: string;
};

type DataCache = {
  leads?: Lead[];
  tasks?: Task[];
  customers?: Customer[];
  projects?: Project[];
  quotations?: Quotation[];
  quotationRequests?: Array<Record<string, unknown>>;
  calendar?: CalendarEvent[];
};

export function TopBar({
  userName,
  roleLabel,
  onMenuClick,
  isMenuOpen,
  menuButtonRef,
}: TopBarProps) {
  const { user, permissions } = useAuth();
  const isAdmin = !!permissions?.includes('admin');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataCacheRef = useRef<DataCache>({});
  const searchRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Have a great morning';
    }
    if (hour < 17) {
      return 'Keep the momentum this afternoon';
    }
    return 'Hope your evening is going well';
  }, []);

  const canViewLeads = hasPermission(permissions ?? [], ['admin', 'lead_view']);
  const canViewAllLeads = hasPermission(permissions ?? [], ['admin', 'lead_view_all']);
  const canViewTasks = hasPermission(permissions ?? [], ['admin', 'task_view']);
  const canViewAllTasks = hasPermission(permissions ?? [], ['admin', 'task_view_all']);
  const canViewCustomers = hasPermission(permissions ?? [], ['admin', 'customer_view']);
  const canViewAllCustomers = hasPermission(permissions ?? [], ['admin', 'customer_view_all']);
  const canViewProjects = hasPermission(permissions ?? [], ['admin', 'project_view']);
  const canViewAllProjects = hasPermission(permissions ?? [], ['admin', 'project_view_all']);
  const canViewQuotations = hasPermission(permissions ?? [], ['admin', 'quotation_view']);
  const canViewAllQuotations = hasPermission(permissions ?? [], ['admin', 'quotation_view_all']);
  const canViewQuotationRequests = hasPermission(permissions ?? [], [
    'admin',
    'quotation_request_view',
  ]);
  const canViewAllQuotationRequests = hasPermission(permissions ?? [], [
    'admin',
    'quotation_request_view_all',
  ]);
  const canViewCalendar = hasPermission(permissions ?? [], ['admin', 'calendar_view']);
  const canViewAllCalendar = hasPermission(permissions ?? [], ['admin', 'calendar_view_all']);
  const canViewProfile = hasPermission(permissions ?? [], ['admin', 'profile_view_self']);

  const resultsByModule = useMemo(() => {
    const grouped = new Map<string, SearchResult[]>();
    results.forEach((result) => {
      const list = grouped.get(result.module) ?? [];
      list.push(result);
      grouped.set(result.module, list);
    });
    const order = [
      'Leads',
      'Tasks',
      'Customers',
      'Projects',
      'Quotations',
      'Quotation Requests',
      'Calendar',
    ];
    return order
      .map((module) => ({ module, items: grouped.get(module) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [results]);

  useEffect(() => {
    if (!showDropdown) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  useEffect(() => {
    const term = query.trim();
    if (!term || term.length < 2 || !user) {
      setResults([]);
      setShowDropdown(Boolean(term));
      setIsSearching(false);
      setError(null);
      return;
    }
    setShowDropdown(true);
    const requestId = ++requestIdRef.current;
    const handle = window.setTimeout(() => {
      const runSearch = async () => {
        setIsSearching(true);
        setError(null);
        try {
          const normalized = term.toLowerCase();
          const matches = (values: Array<string | undefined | null>) =>
            values.some((value) => value?.toLowerCase().includes(normalized));

          const nextResults: SearchResult[] = [];
          const take = <T,>(items: T[], limit: number) => items.slice(0, limit);

          const getLeads = async () => {
            if (dataCacheRef.current.leads) {
              return dataCacheRef.current.leads;
            }
            const data =
              canViewAllLeads || isAdmin
                ? await firebaseLeadRepository.listAll()
                : await firebaseLeadRepository.listByOwner(user.id);
            dataCacheRef.current = { ...dataCacheRef.current, leads: data };
            return data;
          };

          const getTasks = async () => {
            if (dataCacheRef.current.tasks) {
              return dataCacheRef.current.tasks;
            }
            const data =
              canViewAllTasks || isAdmin
                ? await firebaseTaskRepository.listAll()
                : await firebaseTaskRepository.listForUser(user.id, user.role);
            dataCacheRef.current = { ...dataCacheRef.current, tasks: data };
            return data;
          };

          const getCustomers = async () => {
            if (dataCacheRef.current.customers) {
              return dataCacheRef.current.customers;
            }
            const data =
              canViewAllCustomers || isAdmin
                ? await firebaseCustomerRepository.listAll()
                : await firebaseCustomerRepository.listForUser(user.id, user.role);
            dataCacheRef.current = { ...dataCacheRef.current, customers: data };
            return data;
          };

          const getProjects = async () => {
            if (dataCacheRef.current.projects) {
              return dataCacheRef.current.projects;
            }
            const data =
              canViewAllProjects || isAdmin
                ? await firebaseProjectRepository.listAll()
                : await firebaseProjectRepository.listForUser(user.id, user.role);
            dataCacheRef.current = { ...dataCacheRef.current, projects: data };
            return data;
          };

          const getQuotations = async () => {
            if (dataCacheRef.current.quotations) {
              return dataCacheRef.current.quotations;
            }
            const data =
              canViewAllQuotations || isAdmin
                ? await firebaseQuotationRepository.listAll()
                : await firebaseQuotationRepository.listForUser(user.id, user.role);
            dataCacheRef.current = { ...dataCacheRef.current, quotations: data };
            return data;
          };

          const getQuotationRequests = async () => {
            if (dataCacheRef.current.quotationRequests) {
              return dataCacheRef.current.quotationRequests;
            }
            const data = await firebaseQuotationRequestRepository.listAll();
            dataCacheRef.current = { ...dataCacheRef.current, quotationRequests: data };
            return data;
          };

          const getCalendar = async () => {
            if (dataCacheRef.current.calendar) {
              return dataCacheRef.current.calendar;
            }
            const data =
              canViewAllCalendar || isAdmin
                ? await firebaseCalendarRepository.listAll()
                : await firebaseCalendarRepository.listByOwner(user.id);
            dataCacheRef.current = { ...dataCacheRef.current, calendar: data };
            return data;
          };

          if (canViewLeads) {
            const leads = await getLeads();
            const matchesList = leads.filter((lead) =>
              matches([lead.name, lead.company, lead.email, lead.phone, lead.source, lead.status]),
            );
            take(matchesList, 5).forEach((lead) =>
              nextResults.push({
                id: lead.id,
                title: lead.name,
                subtitle: `${lead.company} · ${lead.email}`,
                module: 'Leads',
                href: '/app/crm/leads',
              }),
            );
          }

          if (canViewTasks) {
            const tasks = await getTasks();
            const matchesList = tasks.filter((task) =>
              matches([task.title, task.description, task.leadReference, task.rfqTag]),
            );
            take(matchesList, 5).forEach((task) =>
              nextResults.push({
                id: task.id,
                title: task.title,
                subtitle: task.description || 'Task',
                module: 'Tasks',
                href: '/app/tasks',
              }),
            );
          }

          if (canViewCustomers) {
            const customers = await getCustomers();
            const matchesList = customers.filter((customer) =>
              matches([
                customer.companyName,
                customer.contactPerson,
                customer.email,
                customer.phone,
                customer.source,
                customer.status,
              ]),
            );
            take(matchesList, 5).forEach((customer) =>
              nextResults.push({
                id: customer.id,
                title: customer.companyName,
                subtitle: `${customer.contactPerson} · ${customer.email}`,
                module: 'Customers',
                href: '/app/sales/customers',
              }),
            );
          }

          if (canViewProjects) {
            const projects = await getProjects();
            const matchesList = projects.filter((project) =>
              matches([project.name, project.customerName, project.description, project.status]),
            );
            take(matchesList, 5).forEach((project) =>
              nextResults.push({
                id: project.id,
                title: project.name,
                subtitle: `${project.customerName} · ${project.status}`,
                module: 'Projects',
                href: '/app/sales/projects',
              }),
            );
          }

          if (canViewQuotations) {
            const quotations = await getQuotations();
            const matchesList = quotations.filter((quotation) =>
              matches([
                quotation.quoteNumber,
                quotation.customerName,
                quotation.notes,
                quotation.status,
              ]),
            );
            take(matchesList, 5).forEach((quotation) =>
              nextResults.push({
                id: quotation.id,
                title: quotation.quoteNumber,
                subtitle: `${quotation.customerName} · ${quotation.status}`,
                module: 'Quotations',
                href: '/app/sales/quotations',
              }),
            );
          }

          if (canViewQuotationRequests) {
            const requests = (await getQuotationRequests()) as Array<Record<string, unknown>>;
            const visible = canViewAllQuotationRequests
              ? requests
              : requests.filter((request) => {
                  const requestedBy = String(request.requestedBy ?? '');
                  const recipients = Array.isArray(request.recipients)
                    ? (request.recipients as Array<{ id?: string }>).map((entry) => entry.id)
                    : [];
                  return requestedBy === user.id || recipients.includes(user.id);
                });
            const matchesList = visible.filter((request) =>
              matches([
                String(request.leadName ?? ''),
                String(request.leadCompany ?? ''),
                String(request.leadEmail ?? ''),
                String(request.notes ?? ''),
              ]),
            );
            take(matchesList, 5).forEach((request) =>
              nextResults.push({
                id: String(request.id ?? ''),
                title: String(request.leadName ?? 'Quotation Request'),
                subtitle: String(request.leadCompany ?? ''),
                module: 'Quotation Requests',
                href: '/app/sales/quotation-requests',
              }),
            );
          }

          if (canViewCalendar) {
            const events = await getCalendar();
            const matchesList = events.filter((event) =>
              matches([event.title, event.description, event.category]),
            );
            take(matchesList, 5).forEach((event) =>
              nextResults.push({
                id: event.id,
                title: event.title,
                subtitle: event.category,
                module: 'Calendar',
                href: '/app/crm/calendar',
              }),
            );
          }

          if (requestId === requestIdRef.current) {
            setResults(nextResults);
          }
        } catch {
          if (requestId === requestIdRef.current) {
            setError('Unable to search right now.');
          }
        } finally {
          if (requestId === requestIdRef.current) {
            setIsSearching(false);
          }
        }
      };
      runSearch();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [
    query,
    user,
    isAdmin,
    canViewLeads,
    canViewAllLeads,
    canViewTasks,
    canViewAllTasks,
    canViewCustomers,
    canViewAllCustomers,
    canViewProjects,
    canViewAllProjects,
    canViewQuotations,
    canViewAllQuotations,
    canViewQuotationRequests,
    canViewAllQuotationRequests,
    canViewCalendar,
    canViewAllCalendar,
  ]);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-bg/80 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-4">
        <button
          type="button"
          ref={menuButtonRef}
          onClick={onMenuClick}
          className="rounded-full border border-border/60 bg-surface/70 p-2 text-muted transition hover:-translate-y-[1px] hover:bg-hover/80 hover:text-text"
          aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
        >
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
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted">
            CRM Operations
          </p>
          <h2 className="font-display text-xs text-text sm:text-sm">
            {greeting}, {userName}
          </h2>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-4">
        <div
          ref={searchRef}
          className="relative hidden min-w-[240px] flex-1 rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-sm text-muted shadow-soft transition focus-within:border-accent/70 focus-within:text-text lg:flex"
        >
          <span className="mr-2">?</span>
          <label htmlFor="global-search" className="sr-only">
            Global search
          </label>
          <input
            type="text"
            id="global-search"
            name="global-search"
            placeholder="Search leads, tasks, customers..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setShowDropdown(query.trim().length > 0)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setShowDropdown(false);
              }
            }}
            className="w-full bg-transparent outline-none placeholder:text-muted/70"
          />
          {showDropdown ? (
            <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-full min-w-[360px] rounded-2xl border border-border/60 bg-surface/95 p-3 text-sm text-text shadow-floating backdrop-blur">
              {isSearching ? (
                <div className="rounded-xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted">
                  Searching...
                </div>
              ) : error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              ) : results.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted">
                  No results found.
                </div>
              ) : (
                <div className="max-h-[360px] space-y-3 overflow-y-auto">
                  {resultsByModule.map((group) => (
                    <div key={group.module}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                        {group.module}
                      </p>
                      <div className="mt-2 space-y-2">
                        {group.items.map((item) => (
                          <a
                            key={`${item.module}-${item.id}`}
                            href={item.href}
                            className="block rounded-xl border border-border/60 bg-bg/70 px-3 py-2 transition hover:bg-hover/80"
                          >
                            <p className="text-sm font-semibold text-text">{item.title}</p>
                            <p className="text-xs text-muted">{item.subtitle}</p>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <ThemeToggle />
          {canViewProfile ? (
            <a
              href="/app/profile"
              className="rounded-2xl border border-border/60 bg-surface/70 px-4 py-2 text-left text-xs text-muted transition hover:bg-hover/70"
            >
              <p className="text-[10px] uppercase tracking-[0.26em]">{roleLabel}</p>
              <p className="text-sm font-semibold text-text">{userName}</p>
            </a>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-surface/70 px-4 py-2 text-xs text-muted">
              <p className="text-[10px] uppercase tracking-[0.26em]">{roleLabel}</p>
              <p className="text-sm font-semibold text-text">{userName}</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
