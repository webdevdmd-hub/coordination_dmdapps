import { PermissionKey } from '@/core/entities/permissions';
import { RoleRelations } from '@/lib/roleVisibility';

export type Role = {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
  roleRelations?: RoleRelations;
  createdAt: string;
};
