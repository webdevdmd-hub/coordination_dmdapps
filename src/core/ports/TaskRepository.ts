import { Task } from '@/core/entities/task';

export type CreateTaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface TaskRepository {
  listAll(): Promise<Task[]>;
  listForUser(userId: string, role?: string): Promise<Task[]>;
  listForProject(projectId: string): Promise<Task[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, updates: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;
}
