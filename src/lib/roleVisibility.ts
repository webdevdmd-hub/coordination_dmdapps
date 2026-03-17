import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';

export const ROLE_RELATION_MODULES = [
  'leads',
  'tasks',
  'calendar',
  'customers',
  'projects',
  'quotations',
  'quotationRequests',
  'salesOrder',
] as const;

export type RoleRelationModuleKey = (typeof ROLE_RELATION_MODULES)[number];

export const ROLE_RELATION_MODULE_LABELS: Record<RoleRelationModuleKey, string> = {
  leads: 'Leads',
  tasks: 'Tasks',
  calendar: 'Calendar',
  customers: 'Customers',
  projects: 'Projects',
  quotations: 'Quotations',
  quotationRequests: 'Quotation Requests',
  salesOrder: 'Sales Order',
};

export type ModuleRoleRelation = {
  canViewRoles?: string[];
  canAssignToRoles?: string[];
  canBeAssignedByRoles?: string[];
};

export type RoleRelations = Partial<Record<RoleRelationModuleKey, ModuleRoleRelation>>;

const normalizeRoleKeys = (value: string[] | undefined) =>
  Array.from(
    new Set(
      (value ?? [])
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );

const getCurrentRoleKey = (currentUser: Pick<User, 'id' | 'role'> | null) =>
  (currentUser?.role ?? '').trim().toLowerCase();

export const normalizeRoleRelations = (value: unknown): RoleRelations | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const result: RoleRelations = {};
  ROLE_RELATION_MODULES.forEach((moduleKey) => {
    const raw = source[moduleKey];
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const relation = raw as Record<string, unknown>;
    const canViewRoles = normalizeRoleKeys(
      Array.isArray(relation.canViewRoles) ? (relation.canViewRoles as string[]) : undefined,
    );
    const canAssignToRoles = normalizeRoleKeys(
      Array.isArray(relation.canAssignToRoles) ? (relation.canAssignToRoles as string[]) : undefined,
    );
    const canBeAssignedByRoles = normalizeRoleKeys(
      Array.isArray(relation.canBeAssignedByRoles)
        ? (relation.canBeAssignedByRoles as string[])
        : undefined,
    );
    if (
      canViewRoles.length === 0 &&
      canAssignToRoles.length === 0 &&
      canBeAssignedByRoles.length === 0
    ) {
      return;
    }
    result[moduleKey] = {
      canViewRoles,
      canAssignToRoles,
      canBeAssignedByRoles,
    };
  });
  return Object.keys(result).length > 0 ? result : undefined;
};

export const hasRoleScope = (
  permissions: PermissionKey[],
  roleScopedPermission: PermissionKey,
) => permissions.includes('admin') || permissions.includes(roleScopedPermission);

export const getViewableRoleKeys = (
  currentUser: Pick<User, 'id' | 'role'> | null,
  moduleKey?: RoleRelationModuleKey,
  roleRelations?: RoleRelations,
) => {
  const currentRoleKey = getCurrentRoleKey(currentUser);
  const allowed = new Set<string>();
  if (currentRoleKey === 'admin') {
    return allowed;
  }
  if (!moduleKey) {
    return allowed;
  }
  normalizeRoleKeys(roleRelations?.[moduleKey]?.canViewRoles).forEach((roleKey) =>
    allowed.add(roleKey),
  );
  return allowed;
};

export const hasUserVisibilityAccess = (
  currentUser: Pick<User, 'id' | 'role'> | null,
  moduleKey?: RoleRelationModuleKey,
  roleRelations?: RoleRelations,
) => {
  if (!currentUser) {
    return false;
  }
  if ((currentUser.role ?? '').trim().toLowerCase() === 'admin') {
    return true;
  }
  return getViewableRoleKeys(currentUser, moduleKey, roleRelations).size > 0;
};

export const filterUsersByRole = <T extends Pick<User, 'id' | 'role' | 'active'>>(
  currentUser: Pick<User, 'id' | 'role'> | null,
  users: T[],
  moduleKey?: RoleRelationModuleKey,
  roleRelations?: RoleRelations,
) => {
  const activeUsers = users.filter((entry) => entry.active !== false);
  if (!currentUser) {
    return [];
  }
  if ((currentUser.role ?? '').trim().toLowerCase() === 'admin') {
    return activeUsers;
  }
  const allowedRoleKeys = getViewableRoleKeys(currentUser, moduleKey, roleRelations);
  if (allowedRoleKeys.size === 0) {
    return activeUsers.filter((entry) => entry.id === currentUser.id);
  }
  return activeUsers.filter((entry) => {
    if (entry.id === currentUser.id) {
      return true;
    }
    const entryRoleKey = (entry.role ?? '').trim().toLowerCase();
    return allowedRoleKeys.has(entryRoleKey);
  });
};

export const canAssignAcrossRoles = (
  sourceRoleKey: string,
  targetRoleKey: string,
  moduleKey: RoleRelationModuleKey,
  sourceRelations?: RoleRelations,
  targetRelations?: RoleRelations,
) => {
  const normalizedSource = sourceRoleKey.trim().toLowerCase();
  const normalizedTarget = targetRoleKey.trim().toLowerCase();
  if (!normalizedSource || !normalizedTarget) {
    return false;
  }
  const sourceAllowed = new Set(
    normalizeRoleKeys(sourceRelations?.[moduleKey]?.canAssignToRoles),
  );
  if (!sourceAllowed.has(normalizedTarget)) {
    return false;
  }
  const targetAllowed = new Set(
    normalizeRoleKeys(targetRelations?.[moduleKey]?.canBeAssignedByRoles),
  );
  return targetAllowed.has(normalizedSource);
};
