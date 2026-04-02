'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { TaskPriority, TaskRecurrence } from '@/core/entities/task';
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
const fallbackTaskModalContext: TaskModalContextValue = {
  openTaskModal: () => {},
  isSubmitting: false,
};

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
      description: string;
      startDate: string;
      endDate: string;
      startTime: string;
      endTime: string;
      priority: TaskPriority;
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
        const startDateValue = payload.startDate;
        const endDateValue = payload.endDate;
        const start = new Date(`${startDateValue}T${payload.startTime}:00`);
        const end = new Date(`${endDateValue}T${payload.endTime}:00`);
        if (
          new Date(`${endDateValue}T00:00:00`).getTime() <
          new Date(`${startDateValue}T00:00:00`).getTime()
        ) {
          return 'End date must be on or after start date.';
        }
        if (end.getTime() <= start.getTime()) {
          return 'End date/time must be after start date/time.';
        }
        const assignedTo = context?.ownerId ?? '';
        const createdTask = await firebaseTaskRepository.create({
          title: payload.title.trim(),
          description: payload.description.trim(),
          assignedTo,
          status: 'todo',
          priority: payload.priority,
          recurrence: payload.recurrenceType,
          startDate: startDateValue,
          endDate: endDateValue,
          dueDate: endDateValue,
          sharedRoles: [],
          createdBy: user.id,
          leadId: context?.leadId,
          leadReference: context?.leadName,
          recurrence_type: payload.recurrenceType,
          is_all_day: false,
          startTime: payload.startTime,
          endTime: payload.endTime,
        });
        createdTaskId = createdTask.id;
        await firebaseCalendarRepository.create({
          title: payload.title.trim(),
          description: payload.description.trim(),
          ownerId: assignedTo || user.id,
          type: 'task',
          category: 'task',
          startDate: startDateValue,
          endDate: endDateValue,
          leadId: context?.leadId,
          taskId: createdTask.id,
          recurrence_type: payload.recurrenceType,
          is_all_day: false,
          startTime: payload.startTime,
          endTime: payload.endTime,
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
      } catch (error) {
        if (createdTaskId) {
          await firebaseTaskRepository.delete(createdTaskId);
        }
        if (error instanceof Error && error.message) {
          return error.message;
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
  return context ?? fallbackTaskModalContext;
}
