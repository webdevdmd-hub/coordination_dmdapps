'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { ModuleShell } from '@/components/ui/ModuleShell';
import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import {
  getModuleCacheEntry,
  isModuleCacheFresh,
  MODULE_CACHE_TTL_MS,
  setModuleCacheEntry,
} from '@/lib/moduleDataCache';
import {
  ModuleRoleRelation,
  ROLE_RELATION_MODULE_LABELS,
  ROLE_RELATION_MODULES,
  RoleRelationModuleKey,
  RoleRelations,
} from '@/lib/roleVisibility';

type Role = {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
  roleRelations?: RoleRelations;
};

type NewRole = {
  name: string;
  description: string;
};

type EditRole = {
  name: string;
  description: string;
};

const emptyNewRole: NewRole = {
  name: '',
  description: '',
};

const emptyEditRole: EditRole = {
  name: '',
  description: '',
};

const ROLES_CACHE_KEY = 'admin-roles';

const emptyRoleRelations = (): RoleRelations => ({});

const normalizeRoleRelations = (relations: RoleRelations) =>
  Object.fromEntries(
    Object.entries(relations)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([moduleKey, relation]) => [
        moduleKey,
        {
          canViewRoles: [...(relation.canViewRoles ?? [])].sort((a, b) => a.localeCompare(b)),
          canAssignToRoles: [...(relation.canAssignToRoles ?? [])].sort((a, b) =>
            a.localeCompare(b),
          ),
          canBeAssignedByRoles: [...(relation.canBeAssignedByRoles ?? [])].sort((a, b) =>
            a.localeCompare(b),
          ),
        },
      ]),
  );

const togglePermission = (list: PermissionKey[], value: PermissionKey) => {
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
};

const permissionLabels: Partial<Record<PermissionKey, string>> = {
  task_assign: 'Can Assign Tasks (Same Role)',
};

const formatPermissionLabel = (permission: PermissionKey) => {
  const direct = permissionLabels[permission];
  if (direct) {
    return direct;
  }
  return permission
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const permissionGroups: Array<
  | { title: string; keys: PermissionKey[]; sections?: never }
  | { title: string; sections: Array<{ title: string; keys: PermissionKey[] }> }
> = [
  {
    title: 'Core',
    keys: ['admin', 'dashboard', 'crm', 'tasks', 'sales', 'operations'],
  },
  {
    title: 'CRM',
    sections: [
      {
        title: 'Leads',
        keys: [
          'lead_create',
          'lead_view',
          'lead_edit',
          'lead_delete',
          'lead_source_manage',
        ],
      },
      {
        title: 'Profile',
        keys: [
          'profile_view_self',
          'profile_edit_name',
          'profile_edit_email',
          'profile_edit_phone',
          'profile_edit_avatar',
          'profile_edit_role',
          'profile_password_reset',
        ],
      },
      {
        title: 'Calendar',
        keys: [
          'calendar_create',
          'calendar_view',
          'calendar_edit',
          'calendar_delete',
          'calendar_assign',
        ],
      },
      {
        title: 'Reports',
        keys: ['reports_view'],
      },
    ],
  },
  {
    title: 'Tasks',
    keys: [
      'task_create',
      'task_view',
      'task_edit',
      'task_delete',
      'task_assign',
    ],
  },
  {
    title: 'Sales',
    sections: [
      {
        title: 'Customers',
        keys: [
          'customer_create',
          'customer_view',
          'customer_edit',
          'customer_delete',
          'customer_assign',
        ],
      },
      {
        title: 'Projects',
        keys: [
          'project_create',
          'project_view',
          'project_edit',
          'project_delete',
          'project_assign',
        ],
      },
      {
        title: 'Quotations',
        keys: [
          'quotation_create',
          'quotation_view',
          'quotation_edit',
          'quotation_delete',
          'quotation_assign',
        ],
      },
      {
        title: 'Quotation Requests',
        keys: [
          'quotation_request_create',
          'quotation_request_view',
          'quotation_request_edit',
          'quotation_request_delete',
          'quotation_request_assign',
        ],
      },
      {
        title: 'Invoices',
        keys: ['invoices_view'],
      },
    ],
  },
  {
    title: 'Operations',
    sections: [
      {
        title: 'Sales Order',
        keys: [
          'sales_order',
          'sales_order_request_create',
          'sales_order_request_view',
          'sales_order_request_approve',
        ],
      },
      {
        title: 'Store',
        keys: ['store'],
      },
      {
        title: 'Procurement',
        keys: ['procurement'],
      },
      {
        title: 'Logistics',
        keys: ['logistics'],
      },
      {
        title: 'Marketing',
        keys: ['marketing'],
      },
      {
        title: 'Fleet',
        keys: ['fleet'],
      },
      {
        title: 'Compliance',
        keys: ['compliance'],
      },
      {
        title: 'Settings',
        keys: ['settings'],
      },
    ],
  },
];

export default function Page() {
  const cachedRolesEntry = getModuleCacheEntry<Role[]>(ROLES_CACHE_KEY);
  const [roles, setRoles] = useState<Role[]>(() => cachedRolesEntry?.data ?? []);
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<NewRole>(emptyNewRole);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editRole, setEditRole] = useState<EditRole>(emptyEditRole);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionKey[]>([]);
  const [roleRelationsDraft, setRoleRelationsDraft] = useState<RoleRelations>(emptyRoleRelations);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogMode, setSaveDialogMode] = useState<'confirm' | 'success'>('confirm');

  const syncRoles = useCallback((next: Role[]) => {
    setRoles(next);
    setModuleCacheEntry(ROLES_CACHE_KEY, next);
  }, []);

  const refreshRoles = useCallback(async (options?: { force?: boolean }) => {
    const cachedEntry = getModuleCacheEntry<Role[]>(ROLES_CACHE_KEY);
    if (cachedEntry && !options?.force) {
      setRoles(cachedEntry.data);
      if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
        return;
      }
    }
    setError(null);
    try {
      const response = await fetch('/api/admin/roles', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to load roles.');
      }
      const payload = (await response.json()) as { roles?: Role[] };
      const sorted = [...(payload.roles ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      syncRoles(sorted);
    } catch {
      setError('Unable to load roles. Please try again.');
    }
  }, [syncRoles]);

  useEffect(() => {
    refreshRoles();
  }, [refreshRoles]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const isAdminRole = selectedRole?.key === 'admin';

  useEffect(() => {
    if (roles.length === 0) {
      setSelectedRoleId(null);
      setPermissionDraft([]);
      return;
    }
    setSelectedRoleId((prev) => prev ?? roles[0]?.id ?? null);
  }, [roles]);

  useEffect(() => {
    if (!selectedRole) {
      setPermissionDraft([]);
      setRoleRelationsDraft(emptyRoleRelations());
      return;
    }
    if (selectedRole.key === 'admin') {
      setPermissionDraft(ALL_PERMISSIONS);
      setRoleRelationsDraft(emptyRoleRelations());
      return;
    }
    setPermissionDraft(selectedRole.permissions ?? []);
    setRoleRelationsDraft(selectedRole.roleRelations ?? emptyRoleRelations());
  }, [selectedRole]);

  const availableRoleOptions = useMemo(
    () =>
      roles
        .filter((role) => role.key !== 'admin')
        .map((role) => ({ key: role.key, name: role.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roles],
  );

  const totalConfiguredRelations = useMemo(
    () =>
      isAdminRole
        ? ROLE_RELATION_MODULES.length * availableRoleOptions.length * 3
        : Object.values(roleRelationsDraft).reduce(
            (sum, relation) =>
              sum +
              (relation.canViewRoles?.length ?? 0) +
              (relation.canAssignToRoles?.length ?? 0) +
              (relation.canBeAssignedByRoles?.length ?? 0),
            0,
          ),
    [availableRoleOptions.length, isAdminRole, roleRelationsDraft],
  );

  const activePermissionCount = permissionDraft.length;

  const activeModuleCount = useMemo(() => {
    const modules = new Set<string>();
    permissionDraft.forEach((permission) => {
      const modulePrefix = permission.split('_')[0];
      modules.add(modulePrefix);
    });
    return modules.size;
  }, [permissionDraft]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedRole || selectedRole.key === 'admin') {
      return false;
    }
    const currentPermissions = [...(selectedRole.permissions ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    const draftPermissions = [...permissionDraft].sort((a, b) => a.localeCompare(b));
    const currentRelations = JSON.stringify(
      normalizeRoleRelations(selectedRole.roleRelations ?? emptyRoleRelations()),
    );
    const draftRelations = JSON.stringify(normalizeRoleRelations(roleRelationsDraft));
    return (
      JSON.stringify(currentPermissions) !== JSON.stringify(draftPermissions) ||
      currentRelations !== draftRelations
    );
  }, [permissionDraft, roleRelationsDraft, selectedRole]);

  const toggleRoleRelation = (
    moduleKey: RoleRelationModuleKey,
    relationKey: keyof ModuleRoleRelation,
    roleKey: string,
    enabled: boolean,
  ) => {
    setRoleRelationsDraft((prev) => {
      const moduleRelations = prev[moduleKey] ?? {};
      const nextValues = new Set((moduleRelations[relationKey] ?? []).map((item) => item.trim()));
      if (enabled) {
        nextValues.add(roleKey);
      } else {
        nextValues.delete(roleKey);
      }
      const nextModuleRelations: ModuleRoleRelation = {
        ...moduleRelations,
        [relationKey]: Array.from(nextValues).sort((a, b) => a.localeCompare(b)),
      };
      const hasValues =
        (nextModuleRelations.canViewRoles?.length ?? 0) > 0 ||
        (nextModuleRelations.canAssignToRoles?.length ?? 0) > 0 ||
        (nextModuleRelations.canBeAssignedByRoles?.length ?? 0) > 0;
      if (!hasValues) {
        const nextDraft = { ...prev };
        delete nextDraft[moduleKey];
        return nextDraft;
      }
      return {
        ...prev,
        [moduleKey]: nextModuleRelations,
      };
    });
  };

  const handleCreateRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!newRole.name.trim()) {
      setError('Role name is required.');
      return;
    }
    setIsCreating(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRole.name.trim(),
          description: newRole.description.trim(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to create role.');
      }
      setNewRole(emptyNewRole);
      setIsCreateOpen(false);
      await refreshRoles({ force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create role.';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!selectedRole) {
      return false;
    }
    setError(null);
    setSaveStatus('saving');
    setIsSavingPermissions(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRole.id,
          permissions: permissionDraft,
          roleRelations: roleRelationsDraft,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to update permissions.');
      }
      await refreshRoles({ force: true });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update permissions.';
      setError(message);
      setSaveStatus('error');
      return false;
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const resetDraftToSelectedRole = () => {
    if (!selectedRole) {
      setPermissionDraft([]);
      setRoleRelationsDraft(emptyRoleRelations());
      return;
    }
    if (selectedRole.key === 'admin') {
      setPermissionDraft(ALL_PERMISSIONS);
      setRoleRelationsDraft(emptyRoleRelations());
      return;
    }
    setPermissionDraft(selectedRole.permissions ?? []);
    setRoleRelationsDraft(selectedRole.roleRelations ?? emptyRoleRelations());
    setSaveStatus('idle');
  };

  const openSaveDialog = () => {
    if (!selectedRole || isAdminRole || isSavingPermissions) {
      return;
    }
    setSaveDialogMode('confirm');
    setIsSaveDialogOpen(true);
  };

  const handleConfirmSavePermissions = async () => {
    const didSave = await handleSavePermissions();
    if (didSave) {
      setSaveDialogMode('success');
    }
  };

  const openEditRole = () => {
    if (!selectedRole || selectedRole.key === 'admin') {
      return;
    }
    setEditRole({
      name: selectedRole.name ?? '',
      description: selectedRole.description ?? '',
    });
    setIsEditOpen(true);
  };

  const handleUpdateRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRole) {
      return;
    }
    if (!editRole.name.trim()) {
      setError('Role name is required.');
      return;
    }
    setError(null);
    setIsUpdatingRole(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRole.id,
          name: editRole.name.trim(),
          description: editRole.description.trim(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to update role.');
      }
      setIsEditOpen(false);
      await refreshRoles({ force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update role.';
      setError(message);
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const isRoleRelationEnabled = (
    moduleKey: RoleRelationModuleKey,
    relationKey: keyof ModuleRoleRelation,
    roleKey: string,
  ) =>
    isAdminRole ||
    Boolean(roleRelationsDraft[moduleKey]?.[relationKey]?.includes(roleKey));

  return (
    <ModuleShell
      title="Role management"
      description="Define access templates and permission bundles for every operating group."
      actions={
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="rounded-full border border-border/60 bg-accent/80 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
        >
          Create role
        </button>
      }
    >
      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-[30px] border border-border/60 bg-[linear-gradient(135deg,rgba(6,151,107,0.10),rgba(255,255,255,0.96)_34%,rgba(148,163,184,0.10))] p-6 shadow-soft">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(6,151,107,0.12),transparent_58%)]" />
          <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-border/60 bg-surface/90 p-5 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted/80">Roles</p>
              <p className="mt-4 font-display text-5xl text-text">{roles.length}</p>
              <p className="mt-2 text-sm text-muted">Configured access groups</p>
            </div>
            <div className="rounded-3xl border border-border/60 bg-surface/90 p-5 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted/80">
                Active Permissions
              </p>
              <p className="mt-4 font-display text-5xl text-text">{activePermissionCount}</p>
              <p className="mt-2 text-sm text-muted">Enabled on selected role</p>
            </div>
            <div className="rounded-3xl border border-border/60 bg-surface/90 p-5 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted/80">
                Module Reach
              </p>
              <p className="mt-4 font-display text-5xl text-text">{activeModuleCount}</p>
              <p className="mt-2 text-sm text-muted">Permission families touched</p>
            </div>
            <div className="rounded-3xl border border-border/60 bg-surface/90 p-5 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted/80">
                Role Links
              </p>
              <p className="mt-4 font-display text-5xl text-text">{totalConfiguredRelations}</p>
              <p className="mt-2 text-sm text-muted">Cross-role visibility rules</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="relative overflow-hidden rounded-[30px] border border-border/60 bg-surface/85 p-5 shadow-soft backdrop-blur xl:sticky xl:top-6 xl:max-h-[calc(100vh-7rem)] xl:self-start">
            <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-full bg-accent/10 blur-3xl" />
            <div className="flex items-start justify-between gap-4">
              <div className="relative">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Roles</p>
                <h2 className="mt-2 font-display text-2xl text-text">Access groups</h2>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  hasUnsavedChanges ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {hasUnsavedChanges ? 'Unsaved' : 'Synced'}
              </div>
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Quick select
              </label>
              <select
                value={selectedRoleId ?? ''}
                onChange={(event) => setSelectedRoleId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2.5 text-sm text-text outline-none"
                disabled={roles.length === 0}
              >
                {roles.length === 0 ? (
                  <option value="" disabled>
                    No roles available
                  </option>
                ) : (
                  roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="relative mt-5 space-y-2 pb-2 xl:max-h-[calc(100vh-18rem)] xl:overflow-y-auto xl:pr-2">
              {roles.map((role) => {
                const isSelected = selectedRoleId === role.id;
                const rolePermissionCount =
                  role.key === 'admin' ? ALL_PERMISSIONS.length : role.permissions.length;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isSelected
                        ? 'border-accent/30 bg-[linear-gradient(135deg,rgba(6,151,107,0.14),rgba(6,151,107,0.05))] shadow-[0_12px_24px_rgba(6,151,107,0.10)]'
                        : 'border-border/60 bg-bg/70 hover:border-border hover:bg-hover/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-text">{role.name}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted">
                          {role.key}
                        </p>
                      </div>
                      <span className="rounded-full border border-border/60 bg-surface/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                        {rolePermissionCount}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-muted">
                      {role.description || 'No role description configured.'}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="space-y-4">
          <div className="rounded-[30px] border border-border/60 bg-surface/85 p-6 shadow-soft backdrop-blur">
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Workspace</p>
                <h2 className="mt-2 font-display text-3xl text-text">Permission matrix</h2>
                <p className="mt-2 max-w-3xl text-sm text-muted">
                  Configure module access and role-to-role visibility from one control surface.
                </p>
                {selectedRole ? (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-bg/70 px-4 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                      Editing {selectedRole.name}
                    </span>
                  </div>
                ) : null}
              </div>
              {selectedRole ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">
                      Selected role
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text">{selectedRole.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={openEditRole}
                    disabled={isAdminRole}
                    className="rounded-full border border-border/60 bg-bg/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Edit role
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">
                  Permission coverage
                </p>
                <p className="mt-2 text-2xl font-semibold text-text">{activePermissionCount}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">
                  Role links
                </p>
                <p className="mt-2 text-2xl font-semibold text-text">{totalConfiguredRelations}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">
                  State
                </p>
                <p className="mt-2 text-2xl font-semibold text-text">
                  {isAdminRole ? 'Locked' : hasUnsavedChanges ? 'Draft' : 'Clean'}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {selectedRole ? (
                <>
                  {selectedRole.description ? (
                    <p className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-text">
                      {selectedRole.description}
                    </p>
                  ) : null}
                  {isAdminRole ? (
                    <p className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                      Admin role has full access by default and cannot be edited.
                    </p>
                  ) : null}
                  <div className="space-y-5">
                    {permissionGroups.map((group) => (
                      <div
                        key={group.title}
                        className="rounded-[26px] border border-border/60 bg-transparent p-5"
                      >
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                            {group.title}
                          </p>
                          <p className="mt-1 text-sm text-muted">
                            {'sections' in group && group.sections
                              ? `${group.sections.length} permission clusters`
                              : `${group.keys.length} direct permissions`}
                          </p>
                        </div>
                        {'sections' in group && group.sections ? (
                          <div className="mt-4 rounded-2xl border border-border/60 bg-transparent p-4">
                            <div
                              className={`grid gap-4 ${
                                group.title === 'Operations' ? 'md:grid-cols-2' : ''
                              }`}
                            >
                              {group.sections.map((section) => (
                                <div key={section.title} className="rounded-2xl border border-border/60 bg-transparent p-4">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                                    {section.title}
                                  </p>
                                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    {section.keys.map((permission) => (
                                      <label
                                        key={permission}
                                        className="grid grid-cols-[1fr_auto] items-center rounded-2xl border border-border/60 bg-bg/80 px-4 py-2.5 text-xs text-muted transition hover:border-border hover:bg-hover/10"
                                      >
                                        <span className="font-semibold uppercase tracking-[0.18em] text-text">
                                          {formatPermissionLabel(permission)}
                                        </span>
                                        <input
                                          type="checkbox"
                                          checked={permissionDraft.includes(permission)}
                                          disabled={isAdminRole}
                                          onChange={() =>
                                            setPermissionDraft((prev) =>
                                              togglePermission(prev, permission),
                                            )
                                          }
                                          className="h-4 w-4"
                                        />
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {group.keys.map((permission) => (
                              <label
                                key={permission}
                                className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/80 px-4 py-2.5 text-xs text-muted transition hover:border-border hover:bg-hover/10"
                              >
                                <span className="font-semibold uppercase tracking-[0.18em] text-text">
                                  {formatPermissionLabel(permission)}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={permissionDraft.includes(permission)}
                                  disabled={isAdminRole}
                                  onChange={() =>
                                    setPermissionDraft((prev) => togglePermission(prev, permission))
                                  }
                                  className="h-4 w-4"
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!isAdminRole ? (
                    <div className="rounded-[26px] border border-border/60 bg-transparent p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Module Role Access
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        Same-role and cross-role visibility/assignment are both controlled here. Add
                        the current role as well if users in that role should see or assign to each
                        other.
                      </p>
                      <div className="mt-4 space-y-4">
                        {ROLE_RELATION_MODULES.map((moduleKey) => (
                          <div
                            key={moduleKey}
                            className="rounded-2xl border border-border/60 bg-transparent p-4"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                              {ROLE_RELATION_MODULE_LABELS[moduleKey]}
                            </p>
                            {availableRoleOptions.length === 0 ? (
                              <p className="mt-3 text-sm text-muted">
                                No other roles available for cross-role access.
                              </p>
                            ) : (
                              <div className="mt-3 grid gap-4 xl:grid-cols-3">
                                {([
                                  ['canViewRoles', 'Can View Users'],
                                  ['canAssignToRoles', 'Can Assign To'],
                                  ['canBeAssignedByRoles', 'Can Be Assigned By'],
                                ] as Array<[keyof ModuleRoleRelation, string]>).map(
                                  ([relationKey, label]) => (
                                    <div key={relationKey}>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
                                        {label}
                                      </p>
                                      <div className="mt-2 space-y-2">
                                        {availableRoleOptions.map((roleOption) => (
                                          <label
                                            key={`${moduleKey}-${relationKey}-${roleOption.key}`}
                                            className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/80 px-3 py-2 text-xs text-muted transition hover:border-border hover:bg-hover/10"
                                          >
                                            <span className="font-semibold uppercase tracking-[0.18em] text-text">
                                              {roleOption.name}
                                            </span>
                                            <input
                                              type="checkbox"
                                              checked={isRoleRelationEnabled(
                                                moduleKey,
                                                relationKey,
                                                roleOption.key,
                                              )}
                                              disabled={isAdminRole}
                                              onChange={(event) =>
                                                toggleRoleRelation(
                                                  moduleKey,
                                                  relationKey,
                                                  roleOption.key,
                                                  event.target.checked,
                                                )
                                              }
                                              className="h-4 w-4"
                                            />
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-4 rounded-[26px] border border-border/60 bg-[linear-gradient(135deg,rgba(6,151,107,0.08),rgba(255,255,255,0.9)_24%,rgba(148,163,184,0.08))] p-4 shadow-soft dark:bg-[linear-gradient(135deg,rgba(6,151,107,0.12),rgba(15,23,42,0.92)_26%,rgba(30,41,59,0.4))] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Deployment State
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {hasUnsavedChanges
                          ? 'Changes are staged locally and ready to be applied.'
                          : 'No pending permission changes for this role.'}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled={isSavingPermissions || isAdminRole || !hasUnsavedChanges}
                        onClick={resetDraftToSelectedRole}
                        className="rounded-full border border-border/60 bg-bg/70 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Discard draft
                      </button>
                      <button
                        type="button"
                        disabled={isSavingPermissions || isAdminRole}
                        onClick={openSaveDialog}
                        className="rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingPermissions
                          ? 'Saving...'
                          : saveStatus === 'saved'
                            ? 'Saved'
                            : 'Save permissions'}
                      </button>
                    </div>
                  </div>
                  {saveStatus === 'saved' ? (
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                      Permissions saved.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted">
                  Select a role to update permissions.
                </p>
              )}
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          </div>
        </section>
      </div>

      {isCreateOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => setIsCreateOpen(false)}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Create role"
            className="w-full max-w-2xl animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Create
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">New role</h3>
                <p className="mt-2 text-sm text-muted">
                  Create a role with a name and description.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreateRole}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Role name
                </label>
                <input
                  required
                  value={newRole.name}
                  onChange={(event) =>
                    setNewRole((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  placeholder="Sales Manager"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Description
                </label>
                <textarea
                  value={newRole.description}
                  onChange={(event) =>
                    setNewRole((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="mt-2 min-h-[140px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  placeholder="Describe what this role can access."
                />
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreating ? 'Creating...' : 'Create role'}
              </button>
            </form>
          </DraggablePanel>
        </div>
      ) : null}

      {isEditOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => setIsEditOpen(false)}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Edit role"
            className="w-full max-w-2xl animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Edit</p>
                <h3 className="mt-2 font-display text-2xl text-text">Role details</h3>
                <p className="mt-2 text-sm text-muted">
                  Update role name and description.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleUpdateRole}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Role name
                </label>
                <input
                  required
                  value={editRole.name}
                  onChange={(event) =>
                    setEditRole((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  placeholder="Sales Manager"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Description
                </label>
                <textarea
                  value={editRole.description}
                  onChange={(event) =>
                    setEditRole((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="mt-2 min-h-[140px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-3 text-sm text-text outline-none"
                  placeholder="Describe what this role can access."
                />
              </div>
              <button
                type="submit"
                disabled={isUpdatingRole}
                className="w-full rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUpdatingRole ? 'Updating...' : 'Update role'}
              </button>
            </form>
          </DraggablePanel>
        </div>
      ) : null}

      {isSaveDialogOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={() => {
            if (!isSavingPermissions) {
              setIsSaveDialogOpen(false);
            }
          }}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label={
              saveDialogMode === 'success' ? 'Permissions saved' : 'Confirm save permissions'
            }
            className={`w-full animate-fade-up rounded-3xl border border-border/60 bg-surface/95 shadow-floating ${
              saveDialogMode === 'success' ? 'max-w-sm p-5' : 'max-w-xl p-6'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            {saveDialogMode === 'success' ? (
              <div className="flex flex-col items-center text-center">
                <div className="relative grid h-20 w-20 place-items-center">
                  <span className="absolute inset-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 animate-ping" />
                  <span className="absolute inset-1 rounded-full border border-emerald-400/40 bg-emerald-500/12" />
                  <span className="relative grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.28)]">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-7 w-7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m5 12 5 5L19 8" />
                    </svg>
                  </span>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">
                  Saved
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Permissions updated</h3>
                <p className="mt-2 text-sm text-muted">
                  {selectedRole?.name ?? 'This role'} permissions were saved successfully.
                </p>
                <button
                  type="button"
                  onClick={() => setIsSaveDialogOpen(false)}
                  className="mt-5 w-full rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                      Confirm
                    </p>
                    <h3 className="mt-2 font-display text-2xl text-text">Save permission changes</h3>
                    <p className="mt-2 text-sm text-muted">
                      Apply the current permission matrix and module role access changes to{' '}
                      {selectedRole?.name ?? 'this role'}?
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSavingPermissions) {
                        setIsSaveDialogOpen(false);
                      }
                    }}
                    className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSavingPermissions}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setIsSaveDialogOpen(false)}
                    disabled={isSavingPermissions}
                    className="rounded-full border border-border/60 bg-bg/70 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSavePermissions}
                    disabled={isSavingPermissions}
                    className="rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingPermissions ? 'Saving...' : 'Save permissions'}
                  </button>
                </div>
              </>
            )}
          </DraggablePanel>
        </div>
      ) : null}
    </ModuleShell>
  );
}
