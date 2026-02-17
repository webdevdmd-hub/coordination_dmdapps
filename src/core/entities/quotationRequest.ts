export type QuotationRequestPriority = 'low' | 'medium' | 'high';
export type QuotationRequestStatus = 'new' | 'review' | 'approved' | 'rejected';

export type QuotationRequestRecipient = {
  id: string;
  name: string;
  roleKey: string;
};

export type QuotationRequest = {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  leadEmail: string;
  customerId: string;
  requestedBy: string;
  requestedByName: string;
  recipients: QuotationRequestRecipient[];
  priority: QuotationRequestPriority;
  notes: string;
  tags: string[];
  status: QuotationRequestStatus;
  createdAt: string;
};

export type QuotationRequestTaskStatus = 'pending' | 'assigned' | 'done';

export type QuotationRequestTask = {
  id: string;
  tag: string;
  status: QuotationRequestTaskStatus;
  assignedTo?: string;
  assignedName?: string;
  taskId?: string;
  updatedAt?: string;
  createdAt: string;
};
