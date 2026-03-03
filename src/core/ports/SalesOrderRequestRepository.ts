import { SalesOrderRequest } from '@/core/entities/salesOrderRequest';

export type CreateSalesOrderRequestInput = Omit<
  SalesOrderRequest,
  'id' | 'createdAt' | 'updatedAt'
> & {
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateSalesOrderRequestInput = Partial<Omit<SalesOrderRequest, 'id'>>;

export interface SalesOrderRequestRepository {
  listAll(): Promise<SalesOrderRequest[]>;
  create(input: CreateSalesOrderRequestInput): Promise<SalesOrderRequest>;
  update(id: string, updates: UpdateSalesOrderRequestInput): Promise<SalesOrderRequest>;
  delete(id: string): Promise<void>;
}
