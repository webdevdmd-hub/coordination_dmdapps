export type QuotationStatus = 'draft' | 'sent' | 'approved';

export type QuotationLineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export type Quotation = {
  id: string;
  quoteNumber: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  status: QuotationStatus;
  lineItems: QuotationLineItem[];
  notes: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  assignedTo: string;
  sharedRoles: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
