import { User, UserRole } from '@/core/entities/user';

export type CreateUserInput = {
  id?: string;
  fullName: string;
  email: string;
  role: UserRole;
};

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  listAll(): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
  deactivate(id: string): Promise<void>;
}
