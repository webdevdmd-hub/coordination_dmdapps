'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { TaskRecurrence } from '@/core/entities/task';
import { firebaseTaskRepository } from '@/adapters/repositories/firebaseTaskRepository';
import { firebaseCalendarRepository } from '@/adapters/repositories/firebaseCalendarRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { TaskCalendarModal } from '@/components/tasks/TaskCalendarModal';

type TaskModalContextValue = {
  openTaskModal: (context?: { leadId?: string; leadName?: string; ownerId?: string }) => void;
  isSubmitting: boolean;
};

type TaskContext = {
  leadId?: string;
  leadName?: string;
  ownerId?: string;
};

const TaskModalContext = createContext<TaskModalContextValue | null>(null);

export function TaskModalProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<TaskContext | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  const openTaskModal = useCallback((payload?: TaskContext) => {
    setContext(payload ?? null);
    setModalKey((prev) => prev + 1);
    setOpen(true);
  }, []);

  const closeTaskModal = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSubmit = useCallback(
    async (payload: {
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      isAllDay: boolean;
      recurrenceType: TaskRecurrence;
    }) => {
      if (!user) {
        return 'You must be signed in to add tasks.';
      }
      if (isSubmitting) {
        return null;
      }
      setIsSubmitting(true);
      let createdTaskId: string | null = null;
      try {
        const startTimeValue = payload.isAllDay ? '00:00' : payload.startTime;
        const endTimeValue = payload.isAllDay ? '23:59' : payload.endTime;
        const start = new Date(`${payload.date}T${startTimeValue}:00`);
        const end = new Date(`${payload.date}T${endTimeValue}:00`);
        if (end.getTime() <= start.getTime()) {
          return 'End time must be after the start time.';
        }
        const assignedTo = context?.ownerId ?? '';
        const createdTask = await firebaseTaskRepository.create({
          title: payload.title.trim(),
          description: '',
          assignedTo,
          status: 'todo',
          priority: 'medium',
          recurrence: payload.recurrenceType,
          startDate: payload.date,
          endDate: payload.date,
          dueDate: payload.date,
          sharedRoles: [],
          createdBy: user.id,
          leadId: context?.leadId,
          leadReference: context?.leadName,
          recurrence_type: payload.recurrenceType,
          is_all_day: payload.isAllDay,
          startTime: payload.isAllDay ? '' : payload.startTime,
          endTime: payload.isAllDay ? '' : payload.endTime,
        });
        createdTaskId = createdTask.id;
        await firebaseCalendarRepository.create({
          title: payload.title.trim(),
          ownerId: assignedTo || user.id,
          type: 'task',
          category: 'task',
          startDate: payload.date,
          endDate: payload.date,
          leadId: context?.leadId,
          recurrence_type: payload.recurrenceType,
          is_all_day: payload.isAllDay,
          startTime: payload.isAllDay ? '' : payload.startTime,
          endTime: payload.isAllDay ? '' : payload.endTime,
        });
        if (context?.leadId) {
          await firebaseLeadRepository.addActivity(context.leadId, {
            type: 'task',
            note: 'Task added to calendar.',
            date: new Date().toISOString(),
            createdBy: user.id,
          });
        }
        setOpen(false);
        return null;
      } catch {
        if (createdTaskId) {
          await firebaseTaskRepository.delete(createdTaskId);
        }
        return 'Unable to add task to calendar. Please try again.';
      } finally {
        setIsSubmitting(false);
      }
    },
    [user, context, isSubmitting],
  );

  const value = useMemo(
    () => ({
      openTaskModal,
      isSubmitting,
    }),
    [openTaskModal, isSubmitting],
  );

  return (
    <TaskModalContext.Provider value={value}>
      {children}
      <TaskCalendarModal
        key={modalKey}
        open={open}
        onClose={closeTaskModal}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </TaskModalContext.Provider>
  );
}

export function useTaskModal() {
  const context = useContext(TaskModalContext);
  if (!context) {
    throw new Error('useTaskModal must be used within TaskModalProvider.');
  }
  return context;
}
