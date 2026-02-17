'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { ModuleShell } from '@/components/ui/ModuleShell';
import { PermissionKey } from '@/core/entities/permissions';
import { User, UserRole } from '@/core/entities/user';

type EditableUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  active: boolean;
};

type NewUser = {
  fullName: string;
  email: string;
  role: UserRole;
  active: boolean;
  password: string;
};

type Role = {
  id: string;
  key: string;
  name: string;
  permissions: PermissionKey[];
};

const emptyNewUser: NewUser = {
  fullName: '',
  email: '',
  role: 'agent' as UserRole,
  active: true,
  password: '',
};

export default function Page() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [newUser, setNewUser] = useState(emptyNewUser);
  const [editUser, setEditUser] = useState<EditableUser | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<User | null>(null);

  const refreshUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to load users.');
      }
      const payload = (await response.json()) as { users?: User[] };
      const result = payload.users ?? [];
      const sorted = [...result].sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));
      setUsers(sorted);
    } catch {
      setError('Unable to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const response = await fetch('/api/admin/roles', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to load roles.');
      }
      const payload = (await response.json()) as { roles?: Role[] };
      setRoles(payload.roles ?? []);
    } catch {
      setError('Unable to load roles. Please try again.');
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
    refreshRoles();
  }, [refreshUsers, refreshRoles]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  useEffect(() => {
    if (roles.length === 0) {
      return;
    }
    setNewUser((prev) => {
      if (roles.some((role) => role.key === prev.role)) {
        return prev;
      }
      return { ...prev, role: roles[0]?.key ?? prev.role };
    });
  }, [roles]);

  useEffect(() => {
    if (!selectedUser) {
      setEditUser(null);
      return;
    }
    setEditUser({
      id: selectedUser.id,
      fullName: selectedUser.fullName,
      email: selectedUser.email,
      role: selectedUser.role,
      active: selectedUser.active,
    });
  }, [selectedUser]);

  const formatRoleLabel = useCallback(
    (role: string) => {
      const match = roles.find((item) => item.key === role);
      if (match) {
        return match.name;
      }
      if (!role) {
        return 'Unknown';
      }
      return role.replace(/[_-]/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase());
    },
    [roles],
  );

  const resolveRoleSelection = useCallback(
    (roleValue: string) => {
      const trimmed = roleValue.trim();
      if (!trimmed) {
        return trimmed;
      }
      if (trimmed.toLowerCase() === 'admin') {
        return 'admin';
      }
      const byKey = roles.find((item) => item.key === trimmed);
      if (byKey) {
        return byKey.key;
      }
      const byId = roles.find((item) => item.id === trimmed);
      if (byId) {
        return byId.key;
      }
      const byName = roles.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
      if (byName) {
        return byName.key;
      }
      return trimmed;
    },
    [roles],
  );

  const handleOpenCreate = () => {
    setError(null);
    setNewUser(emptyNewUser);
    setIsCreateOpen(true);
  };

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
  };

  const handleOpenEdit = (userId: string) => {
    setSelectedUserId(userId);
    setIsEditOpen(true);
  };

  const handleCloseEdit = () => {
    setIsEditOpen(false);
  };

  const handleRequestDelete = (user: User) => {
    setError(null);
    setDeleteCandidate(user);
  };

  const handleCancelDelete = () => {
    setDeleteCandidate(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) {
      return;
    }
    setError(null);
    setIsDeleting(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteCandidate.id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to delete user.');
      }
      setUsers((prev) => prev.filter((user) => user.id !== deleteCandidate.id));
      if (selectedUserId === deleteCandidate.id) {
        setSelectedUserId(null);
      }
      setDeleteCandidate(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete user.';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!newUser.fullName.trim() || !newUser.email.trim() || !newUser.password) {
      setError('Full name, email, and password are required.');
      return;
    }
    if (newUser.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (roles.length === 0) {
      setError('Create at least one role before adding users.');
      return;
    }
    const formData = new FormData(event.currentTarget);
    const roleValue = String(formData.get('role') ?? newUser.role);
    setIsCreating(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newUser.fullName.trim(),
          email: newUser.email.trim(),
          role: resolveRoleSelection(roleValue),
          active: newUser.active,
          password: newUser.password,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to create user.');
      }
      setNewUser(emptyNewUser);
      setIsCreateOpen(false);
      await refreshUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create user.';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editUser) {
      return;
    }
    setError(null);
    setIsUpdating(true);
    const formData = new FormData(event.currentTarget);
    const roleValue = String(formData.get('role') ?? editUser.role);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editUser.id,
          fullName: editUser.fullName.trim(),
          email: editUser.email.trim(),
          role: resolveRoleSelection(roleValue),
          active: editUser.active,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? 'Unable to update user.');
      }
      setIsEditOpen(false);
      await refreshUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update user.';
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <ModuleShell
      title="Admin Panel"
      description="User Management. Manage system access, roles, and permissions."
    >
      <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              User Management
            </p>
            <h2 className="mt-2 font-display text-2xl text-text">
              Manage system access and roles.
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={refreshUsers}
              className="rounded-full border border-border/60 bg-surface-strong/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted transition hover:text-text"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80"
            >
              Add user
            </button>
          </div>
        </div>

        <div className="mt-6">
          <div className="space-y-3 md:hidden">
            {loading ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 px-5 py-6 text-sm text-muted">
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-bg/70 px-5 py-6 text-sm text-muted">
                No users found yet. Add the first profile to start.
              </div>
            ) : (
              users.map((user) => {
                const roleLabel = formatRoleLabel(user.role);
                const isAdminRole =
                  roles.find((role) => role.key === user.role)?.permissions?.includes('admin') ??
                  user.role === 'admin';
                const roleClass = isAdminRole
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-emerald-500/20 text-emerald-200';
                return (
                  <div
                    key={user.id}
                    className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-text"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                          Name
                        </p>
                        <p className="mt-1 font-semibold">{user.fullName || 'Unnamed user'}</p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${roleClass}`}
                      >
                        {roleLabel}
                      </span>
                    </div>
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                        Email
                      </p>
                      <p className="mt-1 text-sm text-muted">{user.email}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted">
                      <span className="font-semibold uppercase tracking-[0.2em]">
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full ${
                          user.active ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(user.id)}
                        className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRequestDelete(user)}
                        className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 md:block">
            <div className="min-w-[720px] grid grid-cols-[1.4fr_1.6fr_1.2fr_0.9fr_0.5fr] gap-4 bg-surface-strong/60 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>

            {loading ? (
              <div className="px-5 py-6 text-sm text-muted">Loading users...</div>
            ) : (
              <div className="min-w-[720px] divide-y divide-border/60 bg-bg/60">
                {users.map((user) => {
                  const roleLabel = formatRoleLabel(user.role);
                  const isAdminRole =
                    roles.find((role) => role.key === user.role)?.permissions?.includes('admin') ??
                    user.role === 'admin';
                  const roleClass = isAdminRole
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-emerald-500/20 text-emerald-200';
                  return (
                    <div
                      key={user.id}
                      className="grid grid-cols-[1.4fr_1.6fr_1.2fr_0.9fr_0.5fr] gap-4 px-5 py-4 text-sm text-text"
                    >
                      <div>
                        <p className="font-semibold">{user.fullName || 'Unnamed user'}</p>
                      </div>
                      <div className="text-muted">{user.email}</div>
                      <div>
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${roleClass}`}
                        >
                          {roleLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            user.active ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                        <span className="font-semibold uppercase tracking-[0.2em]">
                          {user.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex justify-end">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(user.id)}
                            className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRequestDelete(user)}
                            className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {users.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-muted">
                    No users found yet. Add the first profile to start.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {isCreateOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseCreate}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Add user"
            className="w-full max-w-3xl animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Create user
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Add new user</h3>
                <p className="mt-2 text-sm text-muted">
                  Create a login in Firebase Authentication and a matching user profile in
                  Firestore.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseCreate}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <div className="mt-2 flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted">
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      {newUser.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewUser((prev) => ({ ...prev, active: !prev.active }))}
                      className={`rounded-full px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] transition ${
                        newUser.active
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      Toggle
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Full name
                  </label>
                  <input
                    required
                    value={newUser.fullName}
                    onChange={(event) =>
                      setNewUser((prev) => ({ ...prev, fullName: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="Alex Morgan"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    value={newUser.email}
                    onChange={(event) =>
                      setNewUser((prev) => ({ ...prev, email: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="alex@company.com"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Password
                  </label>
                  <input
                    required
                    type="password"
                    value={newUser.password}
                    onChange={(event) =>
                      setNewUser((prev) => ({ ...prev, password: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    placeholder="Minimum 6 characters"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Role
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(event) =>
                      setNewUser((prev) => ({
                        ...prev,
                        role: event.target.value as UserRole,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    disabled={rolesLoading || roles.length === 0}
                    name="role"
                  >
                    {roles.length === 0 ? (
                      <option value="" disabled>
                        No roles available
                      </option>
                    ) : (
                      roles.map((role) => (
                        <option key={role.id} value={role.key}>
                          {role.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseCreate}
                  className="rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || rolesLoading || roles.length === 0}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreating ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}

      {isEditOpen && editUser ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseEdit}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Edit user"
            className="w-full max-w-3xl animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
                  Edit user
                </p>
                <h3 className="mt-2 font-display text-2xl text-text">Update access profile</h3>
                <p className="mt-2 text-sm text-muted">
                  Changes apply instantly to the user profile in Firestore.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseEdit}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleUpdate}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Full name
                  </label>
                  <input
                    value={editUser.fullName}
                    onChange={(event) =>
                      setEditUser((prev) =>
                        prev ? { ...prev, fullName: event.target.value } : prev,
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editUser.email}
                    onChange={(event) =>
                      setEditUser((prev) => (prev ? { ...prev, email: event.target.value } : prev))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Role
                  </label>
                  <select
                    value={editUser.role}
                    onChange={(event) =>
                      setEditUser((prev) =>
                        prev ? { ...prev, role: event.target.value as UserRole } : prev,
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                    disabled={rolesLoading || roles.length === 0}
                    name="role"
                  >
                    {roles.length === 0 ? (
                      <option value={editUser.role} disabled>
                        No roles available
                      </option>
                    ) : (
                      roles.map((role) => (
                        <option key={role.id} value={role.key}>
                          {role.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <div className="mt-2 flex items-center justify-between rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted">
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                      {editUser.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditUser((prev) => (prev ? { ...prev, active: !prev.active } : prev))
                      }
                      className={`rounded-full px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] transition ${
                        editUser.active
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      Toggle
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  className="rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUpdating ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCancelDelete}
        >
          <DraggablePanel
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            className="w-full max-w-lg animate-fade-up rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">
              Confirm deletion
            </p>
            <h3 className="mt-2 font-display text-2xl text-text">Delete user account?</h3>
            <p className="mt-3 text-sm text-muted">
              This will permanently remove{' '}
              <span className="font-semibold text-text">{deleteCandidate.fullName}</span> from
              Firebase Authentication and Firestore. This action cannot be undone.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelDelete}
                className="rounded-full border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? 'Deleting...' : 'Delete user'}
              </button>
            </div>
          </DraggablePanel>
        </div>
      ) : null}
    </ModuleShell>
  );
}
