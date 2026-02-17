export type PurchaseOrderRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type PurchaseOrderLineItem = {
  description: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  notes?: string;
};

export type PurchaseOrderApproval = {
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};

export type PurchaseOrderRequest = {
  id: string;
  requestNo: string;
  projectId: string;
  projectName: string;
  customerId: string;
  customerName: string;
  requestedBy: string;
  requestedByName: string;
  vendorId?: string;
  vendorName: string;
  currency: string;
  lineItems: PurchaseOrderLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string;
  status: PurchaseOrderRequestStatus;
  dueDate?: string;
  approval?: PurchaseOrderApproval;
  accountsEntryId?: string;
  createdAt: string;
  updatedAt: string;
};
