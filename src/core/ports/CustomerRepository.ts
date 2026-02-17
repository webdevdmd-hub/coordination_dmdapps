import { Customer } from '@/core/entities/customer';

export type CreateCustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface CustomerRepository {
  listAll(): Promise<Customer[]>;
  listForUser(userId: string, role: string): Promise<Customer[]>;
  create(input: CreateCustomerInput): Promise<Customer>;
  update(id: string, updates: Partial<Customer>): Promise<Customer>;
  delete(id: string): Promise<void>;
}
