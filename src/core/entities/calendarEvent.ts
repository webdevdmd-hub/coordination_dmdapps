export type CalendarItemType = 'event' | 'task';

export type CalendarCategory = 'call' | 'meeting' | 'visit' | 'follow_up' | 'task';

export type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  ownerId: string;
  type: CalendarItemType;
  category: CalendarCategory;
  startDate: string;
  endDate: string;
  leadId?: string;
  taskId?: string;
  recurrence_type?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  is_all_day?: boolean;
  startTime?: string;
  endTime?: string;
  createdAt: string;
  updatedAt: string;
};
