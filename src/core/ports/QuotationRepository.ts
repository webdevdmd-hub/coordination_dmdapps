import { Quotation } from '@/core/entities/quotation';

export type CreateQuotationInput = Omit<
  Quotation,
  'id' | 'createdAt' | 'updatedAt' | 'subtotal' | 'taxAmount' | 'total'
> & {
  createdAt?: string;
  updatedAt?: string;
  subtotal?: number;
  taxAmount?: number;
  total?: number;
};

export type UpdateQuotationInput = Partial<Omit<Quotation, 'id'>>;

export type QuotationRepository = {
  listAll: () => Promise<Quotation[]>;
  listForUser: (userId: string, role: string) => Promise<Quotation[]>;
  create: (input: CreateQuotationInput) => Promise<Quotation>;
  update: (id: string, updates: UpdateQuotationInput) => Promise<Quotation>;
  delete: (id: string) => Promise<void>;
};
