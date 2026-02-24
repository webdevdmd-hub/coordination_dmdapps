'use client';

import { useEffect, useMemo, useState } from 'react';

import { firebaseCalendarRepository } from '@/adapters/repositories/firebaseCalendarRepository';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { CalendarCategory, CalendarEvent, CalendarItemType } from '@/core/entities/calendarEvent';
import { TaskRecurrence } from '@/core/entities/task';
import { User } from '@/core/entities/user';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import { emitNotificationEventSafe } from '@/lib/notifications';

type CalendarFormState = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  type: CalendarItemType;
  category: CalendarCategory;
  ownerId: string;
  leadId: string;
  isAllDay: boolean;
  recurrenceType: TaskRecurrence;
  startTime: string;
  endTime: string;
};

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const primaryViewModes: Array<{ value: 'month' | 'week' | 'day'; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

const categoryOptions: Array<{
  value: CalendarCategory;
  label: string;
  bg: string;
  text: string;
}> = [
  { value: 'call', label: 'Call', bg: '#DBEAFE', text: '#1D4ED8' },
  { value: 'meeting', label: 'Meeting', bg: '#D1FAE5', text: '#047857' },
  { value: 'visit', label: 'Visit', bg: '#FEF3C7', text: '#B45309' },
  { value: 'follow_up', label: 'Follow-up', bg: '#E0E7FF', text: '#4338CA' },
  { value: 'task', label: 'Task', bg: '#FCE7F3', text: '#BE185D' },
];

const categoryStyles = new Map(categoryOptions.map((option) => [option.value, option]));

const createEmptyForm = (ownerId: string, dateKey: string): CalendarFormState => ({
  title: '',
  description: '',
  startDate: dateKey,
  endDate: dateKey,
  type: 'event',
  category: 'call',
  ownerId,
  leadId: '',
  isAllDay: true,
  recurrenceType: 'none',
  startTime: '09:00',
  endTime: '10:00',
});

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromDateKey = (value: string) => new Date(`${value}T00:00:00`);

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const startOfWeek = (date: Date) => {
  const weekday = (date.getDay() + 6) % 7;
  return addDays(date, -weekday);
};

const endOfWeek = (date: Date) => addDays(startOfWeek(date), 6);

const monthLabel = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const daysBetween = (start: Date, end: Date) => {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
};

export default function Page() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CalendarCategory | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<
    'day' | 'week' | 'month' | 'year' | 'schedule' | 'four_days'
  >('month');
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [formState, setFormState] = useState<CalendarFormState>(() =>
    createEmptyForm('', toDateKey(new Date())),
  );

  const canView = !!user && hasPermission(user.permissions, ['admin', 'calendar_view']);
  const canViewAllCalendar =
    !!user && hasPermission(user.permissions, ['admin', 'calendar_view_all']);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'calendar_create']);
  const canAssign = !!user && hasPermission(user.permissions, ['admin', 'calendar_assign']);

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
    const base = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!canViewAllCalendar) {
      return user ? [{ id: user.id, name: user.fullName }] : [];
    }
    return [{ id: 'all', name: 'All sales persons' }, ...base];
  }, [canViewAllCalendar, user, users]);

  const assignableUsers = useMemo(() => {
    return filterAssignableUsers(users, roles, 'calendar_assign');
  }, [users, roles]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!canViewAllCalendar) {
      setOwnerFilter(user.id);
      return;
    }
  }, [user, canViewAllCalendar]);

  const dateInputValue = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }, [currentMonth]);

  const selectedDateLabel = useMemo(() => {
    return fromDateKey(selectedDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [selectedDate]);

  const weekStartDate = useMemo(() => startOfWeek(fromDateKey(selectedDate)), [selectedDate]);

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index));
  }, [weekStartDate]);

  const weekLabel = useMemo(() => {
    const startLabel = weekStartDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = addDays(weekStartDate, 6).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startLabel} - ${endLabel}`;
  }, [weekStartDate]);

  const fourDayDates = useMemo(() => {
    return Array.from({ length: 4 }, (_, index) => addDays(fromDateKey(selectedDate), index));
  }, [selectedDate]);

  const fourDayLabel = useMemo(() => {
    const startLabel = fromDateKey(selectedDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = addDays(fromDateKey(selectedDate), 3).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startLabel} - ${endLabel}`;
  }, [selectedDate]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesCategory = categoryFilter === 'all' ? true : event.category === categoryFilter;
      const matchesOwner = ownerFilter === 'all' ? true : event.ownerId === ownerFilter;
      return matchesCategory && matchesOwner;
    });
  }, [events, categoryFilter, ownerFilter]);

  const yearLabel = useMemo(() => String(currentMonth.getFullYear()), [currentMonth]);

  const yearMonths = useMemo(() => {
    const year = currentMonth.getFullYear();
    return Array.from({ length: 12 }, (_, index) => new Date(year, index, 1));
  }, [currentMonth]);

  const eventsByMonth = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach((eventItem) => {
      const date = fromDateKey(eventItem.startDate);
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
      map.set(key, [...(map.get(key) ?? []), eventItem]);
    });
    return map;
  }, [filteredEvents]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    const days: Date[] = [];
    let cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      days.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    return days;
  }, [currentMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach((event) => {
      const start = fromDateKey(event.startDate);
      const end = fromDateKey(event.endDate);
      let cursor = start;
      while (cursor.getTime() <= end.getTime()) {
        const key = toDateKey(cursor);
        map.set(key, [...(map.get(key) ?? []), event]);
        cursor = addDays(cursor, 1);
      }
    });
    return map;
  }, [filteredEvents]);

  const scheduleGroups = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const items = filteredEvents
      .filter((event) => {
        const date = fromDateKey(event.startDate);
        return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const grouped = new Map<string, CalendarEvent[]>();
    items.forEach((eventItem) => {
      const key = eventItem.startDate;
      grouped.set(key, [...(grouped.get(key) ?? []), eventItem]);
    });

    return Array.from(grouped.entries()).map(([date, list]) => ({
      date,
      list,
    }));
  }, [filteredEvents, currentMonth]);

  const dayEvents = useMemo(() => {
    return eventsByDate.get(selectedDate) ?? [];
  }, [eventsByDate, selectedDate]);

  useEffect(() => {
    const loadUsers = async () => {
      if (!user || !(canViewAllCalendar || canAssign)) {
        setUsers([]);
        setRoles([]);
        return;
      }
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
  }, [user, canViewAllCalendar, canAssign]);

  useEffect(() => {
    const loadEvents = async () => {
      if (!user) {
        setEvents([]);
        setLoading(false);
        return;
      }
      if (!canView) {
        setEvents([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const useAll = canViewAllCalendar && ownerFilter === 'all';
        const result = useAll
          ? await firebaseCalendarRepository.listAll()
          : await firebaseCalendarRepository.listByOwner(
              ownerFilter === 'all' ? user.id : ownerFilter,
            );
        setEvents(result);
      } catch {
        setError('Unable to load calendar events. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadEvents();
  }, [user, canView, canViewAllCalendar, ownerFilter]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const todayKey = toDateKey(new Date());
    setFormState(createEmptyForm(user.id, todayKey));
  }, [user]);

  const openCreateModal = (dateKey?: string) => {
    if (!user) {
      return;
    }
    setEditingEvent(null);
    const targetDate =
      dateKey ??
      (viewMode === 'day' || viewMode === 'week' || viewMode === 'four_days'
        ? selectedDate
        : toDateKey(new Date()));
    setFormState(createEmptyForm(user.id, targetDate));
    setIsDescriptionOpen(false);
    setIsCreateOpen(true);
  };

  const openEditModal = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormState({
      title: event.title,
      description: event.description ?? '',
      startDate: event.startDate,
      endDate: event.endDate,
      type: event.type,
      category: event.category,
      ownerId: event.ownerId,
      leadId: event.leadId ?? '',
      isAllDay: event.is_all_day ?? true,
      recurrenceType: event.recurrence_type ?? 'none',
      startTime: event.startTime ?? '09:00',
      endTime: event.endTime ?? '10:00',
    });
    setIsDescriptionOpen(Boolean(event.description));
    setIsCreateOpen(true);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save events.');
      return;
    }
    if (!canCreate && !editingEvent) {
      setError('You do not have permission to create events.');
      return;
    }
    if (editingEvent && !hasPermission(user.permissions, ['admin', 'calendar_edit'])) {
      setError('You do not have permission to edit events.');
      return;
    }
    if (editingEvent && !user.permissions.includes('admin') && editingEvent.ownerId !== user.id) {
      setError('You do not have permission to edit this event.');
      return;
    }
    if (!formState.title.trim()) {
      setError('Event title is required.');
      return;
    }
    const start = fromDateKey(formState.startDate);
    const end = fromDateKey(formState.endDate);
    if (end.getTime() < start.getTime()) {
      setError('End date must be on or after the start date.');
      return;
    }
    if (!formState.isAllDay && (!formState.startTime || !formState.endTime)) {
      setError('Start and end times are required.');
      return;
    }
    if (
      !formState.isAllDay &&
      formState.startDate === formState.endDate &&
      formState.endTime <= formState.startTime
    ) {
      setError('End time must be after the start time.');
      return;
    }
    setIsSaving(true);
    setError(null);
    let createdTaskId: string | null = null;
    const leadId = formState.leadId.trim();
    try {
      if (editingEvent) {
        const calendarPayload = {
          title: formState.title.trim(),
          description: formState.description.trim() || undefined,
          startDate: formState.startDate,
          endDate: formState.endDate,
          type: formState.type,
          category: formState.category,
          ownerId: formState.ownerId,
          ...(leadId ? { leadId } : {}),
          recurrence_type: formState.recurrenceType,
          is_all_day: formState.isAllDay,
          startTime: formState.isAllDay ? '' : formState.startTime,
          endTime: formState.isAllDay ? '' : formState.endTime,
          updatedAt: new Date().toISOString(),
        };
        const updated = await firebaseCalendarRepository.update(editingEvent.id, {
          ...calendarPayload,
        });
        setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        await emitNotificationEventSafe({
          type: 'calendar.broadcast',
          title: 'Calendar Updated',
          body: `${user.fullName} updated: ${updated.title}.`,
          actorId: user.id,
          broadcast: true,
          entityType: 'calendar',
          entityId: updated.id,
          meta: {
            category: updated.category,
            ownerId: updated.ownerId,
          },
        });
        if (editingEvent.taskId && formState.type === 'task') {
          await firebaseTaskRepository.update(editingEvent.taskId, {
            title: formState.title.trim(),
            startDate: formState.startDate,
            endDate: formState.endDate,
            dueDate: formState.endDate,
            assignedTo: formState.ownerId,
            recurrence: formState.recurrenceType,
            recurrence_type: formState.recurrenceType,
            is_all_day: formState.isAllDay,
            startTime: formState.isAllDay ? '' : formState.startTime,
            endTime: formState.isAllDay ? '' : formState.endTime,
            updatedAt: new Date().toISOString(),
          });
        }
      } else {
        if (formState.type === 'task') {
          const createdTask = await firebaseTaskRepository.create({
            title: formState.title.trim(),
            description: '',
            assignedTo: formState.ownerId,
            status: 'todo',
            priority: 'medium',
            recurrence: formState.recurrenceType,
            startDate: formState.startDate,
            endDate: formState.endDate,
            dueDate: formState.endDate,
            sharedRoles: [],
            createdBy: user.id,
            ...(leadId ? { leadId } : {}),
            recurrence_type: formState.recurrenceType,
            is_all_day: formState.isAllDay,
            startTime: formState.isAllDay ? '' : formState.startTime,
            endTime: formState.isAllDay ? '' : formState.endTime,
          });
          createdTaskId = createdTask.id;
        }
        const calendarPayload = {
          title: formState.title.trim(),
          description: formState.description.trim() || undefined,
          startDate: formState.startDate,
          endDate: formState.endDate,
          type: formState.type,
          category: formState.category,
          ownerId: formState.ownerId,
          ...(leadId ? { leadId } : {}),
          taskId: createdTaskId ?? undefined,
          recurrence_type: formState.recurrenceType,
          is_all_day: formState.isAllDay,
          startTime: formState.isAllDay ? '' : formState.startTime,
          endTime: formState.isAllDay ? '' : formState.endTime,
        };
        const created = await firebaseCalendarRepository.create({
          ...calendarPayload,
        });
        setEvents((prev) => [created, ...prev]);
        await emitNotificationEventSafe({
          type: 'calendar.broadcast',
          title: 'Calendar Updated',
          body: `${user.fullName} scheduled: ${created.title}.`,
          actorId: user.id,
          broadcast: true,
          entityType: 'calendar',
          entityId: created.id,
          meta: {
            category: created.category,
            ownerId: created.ownerId,
          },
        });
      }
      setIsCreateOpen(false);
    } catch {
      setError('Unable to save the event. Please try again.');
      if (createdTaskId) {
        await firebaseTaskRepository.delete(createdTaskId);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingEvent) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete events.');
      return;
    }
    if (!hasPermission(user.permissions, ['admin', 'calendar_delete'])) {
      setError('You do not have permission to delete events.');
      return;
    }
    if (!user.permissions.includes('admin') && editingEvent.ownerId !== user.id) {
      setError('You do not have permission to delete this event.');
      return;
    }
    const confirmed = window.confirm('Delete this event? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseCalendarRepository.delete(editingEvent.id);
      setEvents((prev) => prev.filter((item) => item.id !== editingEvent.id));
      setIsCreateOpen(false);
    } catch {
      setError('Unable to delete the event. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMoveEvent = async (eventId: string, dateKey: string) => {
    if (!user) {
      return;
    }
    const target = events.find((item) => item.id === eventId);
    if (!target) {
      return;
    }
    if (!hasPermission(user.permissions, ['admin', 'calendar_edit'])) {
      return;
    }
    if (!user.permissions.includes('admin') && target.ownerId !== user.id) {
      return;
    }
    const start = fromDateKey(target.startDate);
    const end = fromDateKey(target.endDate);
    const duration = daysBetween(start, end);
    const nextStart = fromDateKey(dateKey);
    const nextEnd = addDays(nextStart, duration);
    try {
      const updated = await firebaseCalendarRepository.update(target.id, {
        startDate: toDateKey(nextStart),
        endDate: toDateKey(nextEnd),
        updatedAt: new Date().toISOString(),
      });
      setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      await emitNotificationEventSafe({
        type: 'calendar.broadcast',
        title: 'Calendar Updated',
        body: `${user.fullName} rescheduled: ${updated.title}.`,
        actorId: user.id,
        broadcast: true,
        entityType: 'calendar',
        entityId: updated.id,
        meta: {
          category: updated.category,
          ownerId: updated.ownerId,
        },
      });
    } catch {
      setError('Unable to move the event. Please try again.');
    }
  };

  const handleDragStart = (eventId: string, event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('text/plain', eventId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (dateKey: string, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const eventId = event.dataTransfer.getData('text/plain');
    if (eventId) {
      handleMoveEvent(eventId, dateKey);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-border bg-surface p-8 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              CRM Calendar
            </p>
            <h1 className="font-display text-6xl text-text">Lead calendar</h1>
            <p className="mt-2 max-w-2xl text-2xl text-muted">
              Schedule tasks and appointments, drag items to reschedule, and keep every lead
              touchpoint aligned.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openCreateModal()}
              disabled={!canCreate}
              className="rounded-2xl border border-accent/30 bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_20px_rgba(6,151,107,0.22)] transition hover:-translate-y-[1px] hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              + Add event
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border bg-surface p-6 shadow-soft">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-3 text-sm text-muted">
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
              <label htmlFor="calendar-category" className="sr-only">
                Category
              </label>
              <select
                id="calendar-category"
                name="calendar-category"
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value as CalendarCategory | 'all')
                }
                className="w-full bg-transparent text-lg text-text outline-none"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-3 text-sm text-muted">
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <label htmlFor="calendar-owner" className="sr-only">
                Owner
              </label>
              <select
                id="calendar-owner"
                name="calendar-owner"
                value={ownerFilter}
                onChange={(event) => setOwnerFilter(event.target.value)}
                disabled={!canViewAllCalendar}
                className="w-full bg-transparent text-lg text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-border bg-[var(--surface-soft)] px-4 py-3 text-sm text-muted">
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
              <label htmlFor="calendar-month" className="sr-only">
                Month
              </label>
              <input
                type="month"
                id="calendar-month"
                name="calendar-month"
                value={dateInputValue}
                onChange={(event) => {
                  const [year, month] = event.target.value.split('-').map(Number);
                  if (!year || !month) {
                    return;
                  }
                  setCurrentMonth(new Date(year, month - 1, 1));
                }}
                className="w-full bg-transparent text-lg text-text outline-none"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-2xl border border-border bg-[var(--surface-muted)] p-1">
                {primaryViewModes.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setViewMode(option.value)}
                    className={`rounded-xl px-6 py-2 text-sm font-semibold uppercase tracking-[0.12em] transition ${
                      viewMode === option.value
                        ? 'bg-black text-white shadow-soft'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2 py-1">
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'day') {
                      const next = addDays(fromDateKey(selectedDate), -1);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'week') {
                      const next = addDays(fromDateKey(selectedDate), -7);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'four_days') {
                      const next = addDays(fromDateKey(selectedDate), -4);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'year') {
                      setCurrentMonth(
                        new Date(currentMonth.getFullYear() - 1, currentMonth.getMonth(), 1),
                      );
                      return;
                    }
                    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
                  }}
                  className="rounded-lg border border-border bg-[var(--surface-soft)] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-text transition hover:bg-[var(--surface-muted)]"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'day') {
                      setSelectedDate(toDateKey(new Date()));
                      return;
                    }
                    if (viewMode === 'week') {
                      setSelectedDate(toDateKey(new Date()));
                      return;
                    }
                    if (viewMode === 'four_days') {
                      setSelectedDate(toDateKey(new Date()));
                      return;
                    }
                    if (viewMode === 'year') {
                      setCurrentMonth(new Date(new Date().getFullYear(), currentMonth.getMonth(), 1));
                      return;
                    }
                    setCurrentMonth(startOfMonth(new Date()));
                  }}
                  className="rounded-lg border border-border bg-[var(--surface-soft)] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-text transition hover:bg-[var(--surface-muted)]"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'day') {
                      const next = addDays(fromDateKey(selectedDate), 1);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'week') {
                      const next = addDays(fromDateKey(selectedDate), 7);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'four_days') {
                      const next = addDays(fromDateKey(selectedDate), 4);
                      setSelectedDate(toDateKey(next));
                      return;
                    }
                    if (viewMode === 'year') {
                      setCurrentMonth(
                        new Date(currentMonth.getFullYear() + 1, currentMonth.getMonth(), 1),
                      );
                      return;
                    }
                    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
                  }}
                  className="rounded-lg border border-border bg-[var(--surface-soft)] px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] text-text transition hover:bg-[var(--surface-muted)]"
                >
                  Next
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-3 py-2 text-xs text-muted">
                <label htmlFor="calendar-view" className="sr-only">
                  Calendar view
                </label>
                <select
                  id="calendar-view"
                  name="calendar-view"
                  value={viewMode}
                  onChange={(event) =>
                    setViewMode(
                      event.target.value as
                        | 'day'
                        | 'week'
                        | 'month'
                        | 'year'
                        | 'schedule'
                        | 'four_days',
                    )
                  }
                  className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                  <option value="schedule">Schedule</option>
                  <option value="four_days">4 days</option>
                </select>
              </div>
              {viewMode === 'day' || viewMode === 'week' || viewMode === 'four_days' ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-[var(--surface-soft)] px-3 py-2 text-xs text-muted">
                  <label htmlFor="calendar-day" className="sr-only">
                    Day
                  </label>
                  <input
                    type="date"
                    id="calendar-day"
                    name="calendar-day"
                    value={selectedDate}
                    onChange={(event) => setSelectedDate(event.target.value)}
                    className="bg-transparent text-xs font-semibold uppercase tracking-[0.2em] text-text outline-none"
                  />
                </div>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">
                {viewMode === 'day'
                  ? 'Day view'
                  : viewMode === 'week'
                    ? 'Week view'
                    : viewMode === 'four_days'
                      ? '4 days view'
                      : viewMode === 'year'
                        ? 'Year view'
                        : 'Month view'}
              </p>
              <h2 className="mt-1 font-display text-5xl text-text">
                {viewMode === 'day'
                  ? selectedDateLabel
                  : viewMode === 'week'
                    ? weekLabel
                    : viewMode === 'four_days'
                      ? fourDayLabel
                      : viewMode === 'year'
                        ? yearLabel
                        : monthLabel(currentMonth)}
              </h2>
            </div>
          </div>
        </div>

        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            You do not have permission to view calendar events.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border bg-[var(--surface-soft)] p-6 text-sm text-muted">
            Loading calendar events...
          </div>
        ) : viewMode === 'day' ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text">Schedule for {selectedDateLabel}</p>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => openCreateModal(selectedDate)}
                  className="rounded-full border border-border/60 bg-bg/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                >
                  Add
                </button>
              ) : null}
            </div>
            {dayEvents.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-border/60 bg-surface/80 p-4 text-sm text-muted">
                No events scheduled for this day.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {dayEvents.map((eventItem) => {
                  const style = categoryStyles.get(eventItem.category);
                  const ownerName = ownerNameMap.get(eventItem.ownerId) ?? eventItem.ownerId;
                  return (
                    <button
                      key={eventItem.id}
                      type="button"
                      draggable={hasPermission(user?.permissions ?? [], ['admin', 'calendar_edit'])}
                      onDragStart={(event) => handleDragStart(eventItem.id, event)}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditModal(eventItem);
                      }}
                      className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-surface/80 px-4 py-3 text-left"
                      style={{
                        borderColor: style?.text ?? undefined,
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold text-text">{eventItem.title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {eventItem.type.toUpperCase()} · {ownerName}
                        </p>
                      </div>
                      <span
                      className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
                      style={{
                        backgroundColor: style?.bg ?? '#E5E7EB',
                        color: style?.text ?? '#111827',
                        borderColor: style?.text ?? '#111827',
                      }}
                      >
                        {eventItem.category.replace('_', ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : viewMode === 'week' ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border/60">
            <div className="grid grid-cols-7 border-b border-border/60 bg-bg/70 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              {weekDays.map((day) => (
                <div key={day} className="px-3 py-3">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {weekDates.map((date) => {
                const dateKey = toDateKey(date);
                const dayEventsList = eventsByDate.get(dateKey) ?? [];
                return (
                  <div
                    key={dateKey}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(dateKey, event)}
                    onClick={() => (canCreate ? openCreateModal(dateKey) : null)}
                    className="min-h-[180px] border-b border-border/60 border-r border-border/60 bg-surface/80 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted">{date.getDate()}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {dayEventsList.slice(0, 4).map((eventItem) => {
                        const style = categoryStyles.get(eventItem.category);
                        const ownerName = ownerNameMap.get(eventItem.ownerId) ?? eventItem.ownerId;
                        return (
                          <button
                            key={`${eventItem.id}-${dateKey}`}
                            type="button"
                            draggable={hasPermission(user?.permissions ?? [], [
                              'admin',
                              'calendar_edit',
                            ])}
                            onDragStart={(event) => handleDragStart(eventItem.id, event)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(eventItem);
                            }}
                            className="w-full rounded-xl border-l-[3px] px-3 py-2 text-left text-xs font-semibold"
                            style={{
                              backgroundColor: style?.bg ?? '#E5E7EB',
                              color: style?.text ?? '#111827',
                              borderLeftColor: style?.text ?? '#111827',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate">{eventItem.title}</span>
                              <span className="ml-2 text-[10px] uppercase">{eventItem.type}</span>
                            </div>
                            <span className="mt-1 block text-[10px] opacity-80">{ownerName}</span>
                          </button>
                        );
                      })}
                      {dayEventsList.length > 4 ? (
                        <span className="text-[11px] text-muted">
                          +{dayEventsList.length - 4} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : viewMode === 'four_days' ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border/60">
            <div className="grid grid-cols-4 border-b border-border/60 bg-bg/70 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              {fourDayDates.map((date) => (
                <div key={toDateKey(date)} className="px-3 py-3">
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-4">
              {fourDayDates.map((date) => {
                const dateKey = toDateKey(date);
                const dayEventsList = eventsByDate.get(dateKey) ?? [];
                return (
                  <div
                    key={dateKey}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(dateKey, event)}
                    onClick={() => (canCreate ? openCreateModal(dateKey) : null)}
                    className="min-h-[200px] border-b border-border/60 border-r border-border/60 bg-surface/80 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted">{date.getDate()}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {dayEventsList.slice(0, 4).map((eventItem) => {
                        const style = categoryStyles.get(eventItem.category);
                        const ownerName = ownerNameMap.get(eventItem.ownerId) ?? eventItem.ownerId;
                        return (
                          <button
                            key={`${eventItem.id}-${dateKey}`}
                            type="button"
                            draggable={hasPermission(user?.permissions ?? [], [
                              'admin',
                              'calendar_edit',
                            ])}
                            onDragStart={(event) => handleDragStart(eventItem.id, event)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(eventItem);
                            }}
                            className="w-full rounded-xl border-l-[3px] px-3 py-2 text-left text-xs font-semibold"
                            style={{
                              backgroundColor: style?.bg ?? '#E5E7EB',
                              color: style?.text ?? '#111827',
                              borderLeftColor: style?.text ?? '#111827',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate">{eventItem.title}</span>
                              <span className="ml-2 text-[10px] uppercase">{eventItem.type}</span>
                            </div>
                            <span className="mt-1 block text-[10px] opacity-80">{ownerName}</span>
                          </button>
                        );
                      })}
                      {dayEventsList.length > 4 ? (
                        <span className="text-[11px] text-muted">
                          +{dayEventsList.length - 4} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : viewMode === 'schedule' ? (
          <div className="mt-6 space-y-4">
            {scheduleGroups.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
                No events scheduled for this month.
              </div>
            ) : (
              scheduleGroups.map((group) => {
                const label = fromDateKey(group.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                return (
                  <div
                    key={group.date}
                    className="rounded-2xl border border-border/60 bg-bg/70 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-text">{label}</p>
                    </div>
                    <div className="mt-3 space-y-2">
                      {group.list.map((eventItem) => {
                        const style = categoryStyles.get(eventItem.category);
                        const ownerName = ownerNameMap.get(eventItem.ownerId) ?? eventItem.ownerId;
                        return (
                          <button
                            key={eventItem.id}
                            type="button"
                            draggable={hasPermission(user?.permissions ?? [], [
                              'admin',
                              'calendar_edit',
                            ])}
                            onDragStart={(event) => handleDragStart(eventItem.id, event)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(eventItem);
                            }}
                            className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-surface/80 px-4 py-3 text-left"
                            style={{ borderColor: style?.text ?? undefined }}
                          >
                            <div>
                              <p className="text-sm font-semibold text-text">{eventItem.title}</p>
                              <p className="mt-1 text-xs text-muted">
                                {eventItem.type.toUpperCase()} · {ownerName}
                              </p>
                            </div>
                            <span
                              className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
                              style={{
                                backgroundColor: style?.bg ?? '#E5E7EB',
                                color: style?.text ?? '#111827',
                                borderColor: style?.text ?? '#111827',
                              }}
                            >
                              {eventItem.category.replace('_', ' ')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : viewMode === 'year' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {yearMonths.map((monthDate, index) => {
              const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth()).padStart(
                2,
                '0',
              )}`;
              const monthEvents = eventsByMonth.get(key) ?? [];
              return (
                <button
                  key={monthDate.toISOString()}
                  type="button"
                  onClick={() => {
                    setCurrentMonth(monthDate);
                    setViewMode('month');
                  }}
                  className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-left transition hover:-translate-y-[2px] hover:bg-hover/70"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text">{monthNames[index]}</p>
                    <span className="rounded-full border border-border/60 bg-surface/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                      {monthEvents.length} events
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categoryOptions.slice(0, 3).map((option) => (
                      <span
                        key={`${key}-${option.value}`}
                        className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
                        style={{ backgroundColor: option.bg, color: option.text }}
                      >
                        {option.label}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
            <div className="grid grid-cols-7 border-b border-border bg-[var(--surface-soft)] text-xs font-semibold uppercase tracking-[0.2em] text-muted/80">
              {weekDays.map((day) => (
                <div key={day} className="px-3 py-3">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((date) => {
                const dateKey = toDateKey(date);
                const dayEvents = eventsByDate.get(dateKey) ?? [];
                const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
                return (
                  <div
                    key={dateKey}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(dateKey, event)}
                    onClick={() => (canCreate ? openCreateModal(dateKey) : null)}
                    className={`min-h-[220px] border-b border-border border-r border-border bg-surface p-3 transition ${
                      isCurrentMonth ? '' : 'bg-[var(--surface-soft)] text-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-muted">{date.getDate()}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {dayEvents.slice(0, 3).map((eventItem) => {
                        const style = categoryStyles.get(eventItem.category);
                        const ownerName = ownerNameMap.get(eventItem.ownerId) ?? eventItem.ownerId;
                        return (
                          <button
                            key={`${eventItem.id}-${dateKey}`}
                            type="button"
                            draggable={hasPermission(user?.permissions ?? [], [
                              'admin',
                              'calendar_edit',
                            ])}
                            onDragStart={(event) => handleDragStart(eventItem.id, event)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditModal(eventItem);
                            }}
                            className="w-full rounded-xl border-l-[3px] px-3 py-2 text-left text-xs font-semibold"
                            style={{
                              backgroundColor: style?.bg ?? '#E5E7EB',
                              color: style?.text ?? '#111827',
                              borderLeftColor: style?.text ?? '#111827',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="truncate">{eventItem.title}</span>
                              <span className="ml-2 text-[10px] uppercase">{eventItem.type}</span>
                            </div>
                            <span className="mt-1 block text-[10px] opacity-80">{ownerName}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 ? (
                        <span className="text-[11px] text-muted">+{dayEvents.length - 3} more</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {isCreateOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => setIsCreateOpen(false)}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Calendar event"
            className="w-full max-w-2xl animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  {editingEvent ? 'Edit event' : 'Create event'}
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">
                  {editingEvent ? 'Update schedule' : 'New calendar item'}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Choose an event or task type and assign it to a date.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSave}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Title
                </label>
                <input
                  required
                  value={formState.title}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, title: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  placeholder="Discovery call with Atlas"
                />
              </div>

              <div className="rounded-2xl border border-border/60 bg-bg/60">
                <button
                  type="button"
                  onClick={() => setIsDescriptionOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  aria-expanded={isDescriptionOpen}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Description
                  </span>
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full border border-border/60 text-xs text-muted transition ${
                      isDescriptionOpen ? 'rotate-180 bg-surface/80' : 'bg-bg/80'
                    }`}
                  >
                    ▾
                  </span>
                </button>
                <div
                  className={`overflow-hidden px-4 transition-[max-height,opacity] duration-300 ${
                    isDescriptionOpen ? 'max-h-48 pb-4 opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <textarea
                    value={formState.description}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, description: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                    rows={3}
                    placeholder="Add notes about the agenda or key details."
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Type
                  </label>
                  <select
                    value={formState.type}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        type: event.target.value as CalendarItemType,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  >
                    <option value="event">Event</option>
                    <option value="task">Task</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Category
                  </label>
                  <select
                    value={formState.category}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        category: event.target.value as CalendarCategory,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  All-day
                  <span className="relative inline-flex h-6 w-11 items-center">
                    <input
                      type="checkbox"
                      checked={formState.isAllDay}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setFormState((prev) => ({
                          ...prev,
                          isAllDay: checked,
                          startTime: checked ? '' : prev.startTime || '09:00',
                          endTime: checked ? '' : prev.endTime || '10:00',
                        }));
                      }}
                      className="peer sr-only"
                    />
                    <span className="h-6 w-11 rounded-full bg-border/60 transition peer-checked:bg-accent-strong/80" />
                    <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                  </span>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  Repeat
                  <select
                    value={formState.recurrenceType}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        recurrenceType: event.target.value as TaskRecurrence,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={formState.startDate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, startDate: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    End date
                  </label>
                  <input
                    type="date"
                    value={formState.endDate}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, endDate: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  />
                </div>
              </div>

              {!formState.isAllDay ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      Start time
                    </label>
                    <input
                      type="time"
                      value={formState.startTime}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, startTime: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      End time
                    </label>
                    <input
                      type="time"
                      value={formState.endTime}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, endTime: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Owner
                  </label>
                  <select
                    value={formState.ownerId}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, ownerId: event.target.value }))
                    }
                    disabled={!canAssign}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                  >
                    {!canAssign ? (
                      <option value={formState.ownerId}>
                        {ownerNameMap.get(formState.ownerId) ?? formState.ownerId}
                      </option>
                    ) : assignableUsers.length === 0 ? (
                      <option value="" disabled>
                        No eligible owners
                      </option>
                    ) : (
                      assignableUsers.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.fullName}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : editingEvent ? 'Save changes' : 'Create event'}
                </button>
                {editingEvent ? (
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={handleDelete}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                ) : null}
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}
