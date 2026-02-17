import { PermissionKey } from '@/core/entities/permissions';

export type Role = {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
  createdAt: string;
};
