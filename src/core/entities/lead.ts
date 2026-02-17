export type LeadStatus = 'new' | 'contacted' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type LeadActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task';

export type LeadActivity = {
  id: string;
  type: LeadActivityType;
  note: string;
  date: string;
  createdBy: string;
};

export type Lead = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  ownerId: string;
  status: LeadStatus;
  value: number;
  source: string;
  createdAt: string;
  lastTouchedAt: string;
  nextStep: string;
  activities: LeadActivity[];
};
