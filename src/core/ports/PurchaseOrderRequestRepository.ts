import { PurchaseOrderRequest } from '@/core/entities/purchaseOrderRequest';

export type CreatePurchaseOrderRequestInput = Omit<
  PurchaseOrderRequest,
  'id' | 'createdAt' | 'updatedAt'
> & {
  createdAt?: string;
  updatedAt?: string;
};

export type UpdatePurchaseOrderRequestInput = Partial<Omit<PurchaseOrderRequest, 'id'>>;

export interface PurchaseOrderRequestRepository {
  listAll(): Promise<PurchaseOrderRequest[]>;
  create(input: CreatePurchaseOrderRequestInput): Promise<PurchaseOrderRequest>;
  update(id: string, updates: UpdatePurchaseOrderRequestInput): Promise<PurchaseOrderRequest>;
  delete(id: string): Promise<void>;
}
