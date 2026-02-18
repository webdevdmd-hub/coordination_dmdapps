export type PurchaseOrderRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

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
  estimateNumber: string;
  estimateAmount: number;
  poNumber: string;
  poAmount: number;
  poDate: string;
  status: PurchaseOrderRequestStatus;
  approval?: PurchaseOrderApproval;
  salesOrderEntryId?: string;
  createdAt: string;
  updatedAt: string;
};
