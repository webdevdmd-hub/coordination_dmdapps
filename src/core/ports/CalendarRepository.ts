import { CalendarEvent } from '@/core/entities/calendarEvent';

export type CreateCalendarEventInput = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface CalendarRepository {
  listByOwner(ownerId: string): Promise<CalendarEvent[]>;
  listAll(): Promise<CalendarEvent[]>;
  create(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  update(id: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>;
  delete(id: string): Promise<void>;
}
