'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { ModuleShell } from '@/components/ui/ModuleShell';
import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';

type Role = {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
  departmentScope?: {
    viewUsersDepartmentIds?: string[];
    assignTasksDepartmentIds?: string[];
  };
};

type NewRole = {
  name: string;
  description: string;
};

type EditRole = {
  name: string;
  description: string;
};

type DepartmentScopeDraft = {
  viewUsersDepartmentIds: string[];
  assignTasksDepartmentIds: string[];
};

const emptyNewRole: NewRole = {
  name: '',
  description: '',
};

const emptyEditRole: EditRole = {
  name: '',
  description: '',
};

const emptyDepartmentScopeDraft: DepartmentScopeDraft = {
  viewUsersDepartmentIds: [],
  assignTasksDepartmentIds: [],
};

const togglePermission = (list: PermissionKey[], value: PermissionKey) => {
  if (list.includes(value)) {
    return list.filter((item) => item !== value);
  }
  return [...list, value];
};

const permissionLabels: Partial<Record<PermissionKey, string>> = {
  department_view_users_other_departments: 'Can View Users (Role-wise)',
  department_assign_tasks_other_departments: 'Can Assign Tasks (Role-wise)',
  task_assign: 'Can Assign Tasks (Own Department)',
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
          'lead_view_all',
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
    keys: ['task_create', 'task_view', 'task_edit', 'task_delete', 'task_assign'],
  },
  {
    title: 'Role Permissions',
    keys: [
      'department_view_users_other_departments',
      'department_assign_tasks_other_departments',
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
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<NewRole>(emptyNewRole);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editRole, setEditRole] = useState<EditRole>(emptyEditRole);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionKey[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [departmentScopeDraft, setDepartmentScopeDraft] = useState<DepartmentScopeDraft>(
    emptyDepartmentScopeDraft,
  );
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const refreshRoles = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/admin/roles', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to load roles.');
      }
      const payload = (await response.json()) as { roles?: Role[] };
      const sorted = [...(payload.roles ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      setRoles(sorted);
    } catch {
      setError('Unable to load roles. Please try again.');
    }
  }, []);

  useEffect(() => {
    refreshRoles();
  }, [refreshRoles]);

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const response = await fetch('/api/admin/roles', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Unable to load roles.');
        }
        const payload = (await response.json()) as {
          roles?: Array<{ key?: unknown; name?: unknown }>;
        };
        const options = Array.from(
          new Set(
            (payload.roles ?? [])
              .map((item) => (typeof item.key === 'string' ? item.key.trim() : ''))
              .filter((item) => item.length > 0),
          ),
        ).sort((a, b) => a.localeCompare(b));
        setDepartmentOptions(options);
      } catch {
        setDepartmentOptions([]);
      }
    };
    loadDepartments();
  }, []);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const isAdminRole = selectedRole?.key === 'admin';
  const isDepartmentViewEnabled = permissionDraft.includes(
    'department_view_users_other_departments',
  );
  const isDepartmentAssignEnabled = permissionDraft.includes(
    'department_assign_tasks_other_departments',
  );

  const toggleDepartmentScope = (
    key: keyof DepartmentScopeDraft,
    departmentId: string,
    enabled: boolean,
  ) => {
    setDepartmentScopeDraft((prev) => {
      const current = new Set(prev[key]);
      if (enabled) {
        current.add(departmentId);
      } else {
        current.delete(departmentId);
      }
      return {
        ...prev,
        [key]: Array.from(current),
      };
    });
  };

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
      setDepartmentScopeDraft(emptyDepartmentScopeDraft);
      return;
    }
    if (selectedRole.key === 'admin') {
      setPermissionDraft(ALL_PERMISSIONS);
      setDepartmentScopeDraft(emptyDepartmentScopeDraft);
      return;
    }
    setPermissionDraft(selectedRole.permissions ?? []);
    setDepartmentScopeDraft({
      viewUsersDepartmentIds: selectedRole.departmentScope?.viewUsersDepartmentIds ?? [],
      assignTasksDepartmentIds: selectedRole.departmentScope?.assignTasksDepartmentIds ?? [],
    });
  }, [selectedRole]);

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
      await refreshRoles();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create role.';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!selectedRole) {
      return;
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
          departmentScope: {
            viewUsersDepartmentIds: isDepartmentViewEnabled
              ? departmentScopeDraft.viewUsersDepartmentIds
              : [],
            assignTasksDepartmentIds: isDepartmentAssignEnabled
              ? departmentScopeDraft.assignTasksDepartmentIds
              : [],
          },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to update permissions.');
      }
      await refreshRoles();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update permissions.';
      setError(message);
      setSaveStatus('error');
    } finally {
      setIsSavingPermissions(false);
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
      await refreshRoles();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update role.';
      setError(message);
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const roleWiseAccessPanel = (
    <div className="rounded-2xl border border-border/60 bg-bg/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
        Role-Wise Access
      </p>
      {!isDepartmentViewEnabled && !isDepartmentAssignEnabled ? (
        <p className="mt-3 text-sm text-muted">
          Enable `Can View Users (Role-wise)` or `Can Assign Tasks (Role-wise)` above to configure role selection.
        </p>
      ) : departmentOptions.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No roles found to scope.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {isDepartmentViewEnabled ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                Can View Users (Role-wise)
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {departmentOptions.map((departmentId) => {
                  const roleLabel =
                    roles.find((role) => role.key === departmentId)?.name ?? departmentId;
                  return (
                    <label
                      key={`view-${departmentId}`}
                      className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted"
                    >
                      <span className="font-semibold uppercase tracking-[0.18em]">
                        {roleLabel}
                      </span>
                      <input
                        type="checkbox"
                        checked={departmentScopeDraft.viewUsersDepartmentIds.includes(departmentId)}
                        disabled={isAdminRole}
                        onChange={(event) =>
                          toggleDepartmentScope(
                            'viewUsersDepartmentIds',
                            departmentId,
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          {isDepartmentAssignEnabled ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                Can Assign Tasks (Role-wise)
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {departmentOptions.map((departmentId) => {
                  const roleLabel =
                    roles.find((role) => role.key === departmentId)?.name ?? departmentId;
                  return (
                    <label
                      key={`assign-${departmentId}`}
                      className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-3 py-2 text-xs text-muted"
                    >
                      <span className="font-semibold uppercase tracking-[0.18em]">
                        {roleLabel}
                      </span>
                      <input
                        type="checkbox"
                        checked={departmentScopeDraft.assignTasksDepartmentIds.includes(
                          departmentId,
                        )}
                        disabled={isAdminRole}
                        onChange={(event) =>
                          toggleDepartmentScope(
                            'assignTasksDepartmentIds',
                            departmentId,
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <ModuleShell
      title="Role management"
      description="Define access templates and permission bundles for every operating group."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-full border border-border/60 bg-accent/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
          >
            Create role
          </button>
        </div>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Settings</p>
            <h2 className="mt-2 font-display text-2xl text-text">Permission matrix</h2>
            <p className="mt-2 text-sm text-muted">
              Toggle access for every module after the role is created.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Select role
                </label>
                <select
                  value={selectedRoleId ?? ''}
                  onChange={(event) => setSelectedRoleId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
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
              {selectedRole ? (
                <>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={openEditRole}
                      disabled={isAdminRole}
                      className="rounded-full border border-border/60 bg-bg/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Edit role
                    </button>
                  </div>
                  {selectedRole.description ? (
                    <p className="rounded-2xl border border-border/60 bg-bg/70 p-3 text-sm text-text">
                      {selectedRole.description}
                    </p>
                  ) : null}
                  {isAdminRole ? (
                    <p className="rounded-2xl border border-border/60 bg-bg/70 p-3 text-sm text-muted">
                      Admin role has full access by default and cannot be edited.
                    </p>
                  ) : null}
                  <div className="space-y-4">
                    {permissionGroups.map((group) => (
                      <div key={group.title} className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                          {group.title}
                        </p>
                        {'sections' in group && group.sections ? (
                          <div className="rounded-2xl border border-border/60 bg-bg/50 p-4">
                            <div
                              className={`grid gap-4 ${
                                group.title === 'Operations' ? 'md:grid-cols-2' : ''
                              }`}
                            >
                              {group.sections.map((section) => (
                                <div key={section.title}>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                                    {section.title}
                                  </p>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {section.keys.map((permission) => (
                                      <label
                                        key={permission}
                                        className="grid grid-cols-[1fr_auto] items-center rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted"
                                      >
                                        <span className="font-semibold uppercase tracking-[0.2em]">
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
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {group.keys.map((permission) => (
                              <label
                                key={permission}
                                className="flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted"
                              >
                                <span className="font-semibold uppercase tracking-[0.2em]">
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
                        {group.title === 'Role Permissions' ? roleWiseAccessPanel : null}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={isSavingPermissions || isAdminRole}
                    onClick={handleSavePermissions}
                    className="w-full rounded-full border border-border/60 bg-accent/80 px-5 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingPermissions
                      ? 'Saving...'
                      : saveStatus === 'saved'
                        ? 'Saved'
                        : 'Save permissions'}
                  </button>
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
    </ModuleShell>
  );
}
