export type SalesOrderRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type SalesOrderRequestApproval = {
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};

export type SalesOrderRequest = {
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
  salesOrderNumber: string;
  salesOrderAmount: number;
  salesOrderDate: string;
  taskTags?: string[];
  status: SalesOrderRequestStatus;
  approval?: SalesOrderRequestApproval;
  salesOrderEntryId?: string;
  sentToStore?: boolean;
  sentToStoreAt?: string;
  sentToStoreBy?: string;
  sentToStoreByName?: string;
  storeReceived?: boolean;
  storeReceivedAt?: string;
  storeReceivedBy?: string;
  storeReceivedByName?: string;
  createdAt: string;
  updatedAt: string;
};
