export type QuotationRequestPriority = 'low' | 'medium' | 'high';
export type QuotationRequestStatus = 'new' | 'pending' | 'review' | 'completed';

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
  dueDate?: string;
  assignedTo?: string;
  assignedName?: string;
  taskId?: string;
  estimateNumber?: string;
  estimateAmount?: number;
  updatedAt?: string;
  createdAt: string;
};

export const normalizeQuotationRequestStatus = (value: unknown): QuotationRequestStatus => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'pending' || normalized === 'review' || normalized === 'completed') {
    return normalized;
  }

  if (normalized === 'approved' || normalized === 'rejected') {
    return 'review';
  }

  return 'new';
};
