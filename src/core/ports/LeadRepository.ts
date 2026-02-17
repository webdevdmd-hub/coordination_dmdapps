import { Lead, LeadActivity } from '@/core/entities/lead';

export type CreateLeadInput = Omit<Lead, 'id' | 'createdAt' | 'lastTouchedAt'> & {
  createdAt?: string;
  lastTouchedAt?: string;
};

export interface LeadRepository {
  getById(id: string): Promise<Lead | null>;
  listByOwner(ownerId: string): Promise<Lead[]>;
  listAll(): Promise<Lead[]>;
  create(input: CreateLeadInput): Promise<Lead>;
  update(id: string, updates: Partial<Lead>): Promise<Lead>;
  delete(id: string): Promise<void>;
  listActivities(leadId: string): Promise<LeadActivity[]>;
  addActivity(leadId: string, activity: Omit<LeadActivity, 'id'>): Promise<LeadActivity>;
}
