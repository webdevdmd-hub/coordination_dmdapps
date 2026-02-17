export type CustomerStatus =
  | 'active'
  | 'inactive'
  | 'new'
  | 'contacted'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

export type Customer = {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  source: string;
  status: CustomerStatus;
  assignedTo: string;
  sharedRoles: string[];
  createdBy: string;
  leadId?: string;
  createdAt: string;
  updatedAt: string;
};
