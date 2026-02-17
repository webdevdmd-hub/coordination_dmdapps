'use client';

import { useState } from 'react';

import { TaskRecurrence } from '@/core/entities/task';
import { DraggablePanel } from '@/components/ui/DraggablePanel';

type TaskCalendarModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    recurrenceType: TaskRecurrence;
  }) => Promise<string | null>;
  isSubmitting?: boolean;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

export function TaskCalendarModal({
  open,
  onClose,
  onSubmit,
  isSubmitting = false,
}: TaskCalendarModalProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(true);
  const [recurrenceType, setRecurrenceType] = useState<TaskRecurrence>('none');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !date) {
      setError('Task title and date are required.');
      return;
    }
    if (!isAllDay && (!startTime || !endTime)) {
      setError('Start and end times are required.');
      return;
    }
    setError(null);
    const result = await onSubmit({
      title,
      date,
      startTime,
      endTime,
      isAllDay,
      recurrenceType,
    });
    if (result) {
      setError(result);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      data-modal-overlay="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <DraggablePanel
        className="w-full max-w-xl overflow-hidden rounded-[28px] bg-surface/95 bg-clip-padding p-6 shadow-floating"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-2xl font-semibold text-text">Add Task to Calendar</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-hover/80"
            aria-label="Close add task"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-4 h-px w-full bg-border/60" />

        <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Task Title
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              All-day
              <span className="relative inline-flex h-6 w-11 items-center">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setIsAllDay(checked);
                    if (checked) {
                      setStartTime('');
                      setEndTime('');
                    } else {
                      setStartTime((prev) => prev || '09:00');
                      setEndTime((prev) => prev || '10:00');
                    }
                  }}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-full bg-border/60 transition peer-checked:bg-accent/80" />
                <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
              </span>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Repeat
              <select
                value={recurrenceType}
                onChange={(event) => setRecurrenceType(event.target.value as TaskRecurrence)}
                className="mt-2 w-full rounded-xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
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
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Date
              <input
                required
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
              />
            </label>
            {!isAllDay ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  Start Time
                  <input
                    required
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  End Time
                  <input
                    required
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  />
                </label>
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold text-muted transition hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-2xl bg-accent/80 px-6 py-3 text-sm font-semibold text-text transition hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Adding...' : 'Add Task to Calendar'}
            </button>
          </div>
        </form>
      </DraggablePanel>
    </div>
  );
}
