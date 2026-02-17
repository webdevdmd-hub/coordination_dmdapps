import { Project } from '@/core/entities/project';

export type CreateProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface ProjectRepository {
  listAll(): Promise<Project[]>;
  listForUser(userId: string, role: string): Promise<Project[]>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, updates: Partial<Project>): Promise<Project>;
  delete(id: string): Promise<void>;
}
