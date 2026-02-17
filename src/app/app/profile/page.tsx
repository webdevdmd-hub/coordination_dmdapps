'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { sendPasswordResetEmail, updateEmail } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { useAuth } from '@/components/auth/AuthProvider';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { compressImage } from '@/lib/imageCompression';
import { getFirebaseAuth, getFirebaseStorage } from '@/frameworks/firebase/client';
import { hasPermission } from '@/lib/permissions';

type ProfileForm = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  active: boolean;
  createdAt: string;
  avatarUrl: string;
};

const formatDate = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function Page() {
  const { user, permissions } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [profileSnapshot, setProfileSnapshot] = useState<ProfileForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const canViewProfile = hasPermission(permissions ?? [], ['admin', 'profile_view_self']);
  const canEditName = hasPermission(permissions ?? [], ['admin', 'profile_edit_name']);
  const canEditEmail = hasPermission(permissions ?? [], ['admin', 'profile_edit_email']);
  const canEditPhone = hasPermission(permissions ?? [], ['admin', 'profile_edit_phone']);
  const canEditAvatar = hasPermission(permissions ?? [], ['admin', 'profile_edit_avatar']);
  const canEditRole = hasPermission(permissions ?? [], ['admin', 'profile_edit_role']);
  const canResetPassword = hasPermission(permissions ?? [], ['admin', 'profile_password_reset']);

  useEffect(() => {
    if (!user || !canViewProfile) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    firebaseUserRepository
      .getById(user.id)
      .then((data) => {
        const next: ProfileForm = {
          fullName: data?.fullName ?? user.fullName,
          email: data?.email ?? user.email,
          phone: data?.phone ?? user.phone ?? '',
          role: data?.role ?? user.role,
          active: data?.active ?? user.active,
          createdAt: data?.createdAt ?? '',
          avatarUrl: data?.avatarUrl ?? user.avatarUrl ?? '',
        };
        setProfileForm(next);
        setProfileSnapshot(next);
      })
      .catch(() => {
        setError('Unable to load profile.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, canViewProfile]);

  const handleSave = async () => {
    if (!user || !profileForm || !profileSnapshot) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updates: Record<string, unknown> = {};
      if (canEditName && profileForm.fullName.trim() !== profileSnapshot.fullName) {
        updates.fullName = profileForm.fullName.trim();
      }
      if (canEditPhone && profileForm.phone.trim() !== profileSnapshot.phone) {
        updates.phone = profileForm.phone.trim();
      }
      if (canEditRole && profileForm.role !== profileSnapshot.role) {
        updates.role = profileForm.role;
      }

      const emailChanged = canEditEmail && profileForm.email.trim() !== profileSnapshot.email;
      if (emailChanged) {
        const auth = getFirebaseAuth();
        if (auth.currentUser) {
          await updateEmail(auth.currentUser, profileForm.email.trim());
          updates.email = profileForm.email.trim();
        } else {
          throw new Error('Unable to update email.');
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString();
        const updated = await firebaseUserRepository.update(user.id, updates);
        const next: ProfileForm = {
          fullName: updated.fullName,
          email: updated.email,
          phone: updated.phone ?? '',
          role: updated.role,
          active: updated.active,
          createdAt: updated.createdAt,
          avatarUrl: updated.avatarUrl ?? profileForm.avatarUrl,
        };
        setProfileForm(next);
        setProfileSnapshot(next);
        setNotice('Profile updated.');
      } else {
        setNotice('No changes to save.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update profile.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user || !canResetPassword || !profileForm?.email) {
      return;
    }
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), profileForm.email);
      setNotice('Password reset email sent.');
    } catch {
      setError('Unable to send password reset email.');
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!user || !canEditAvatar) {
      return;
    }
    setAvatarUploading(true);
    setError(null);
    setNotice(null);
    try {
      const compressed = await compressImage(file, { maxSize: 512, quality: 0.8 });
      const storage = getFirebaseStorage();
      const avatarRef = ref(storage, `avatars/${user.id}/profile.jpg`);
      await uploadBytes(avatarRef, compressed, { contentType: 'image/jpeg' });
      const downloadUrl = await getDownloadURL(avatarRef);
      await firebaseUserRepository.update(user.id, {
        avatarUrl: downloadUrl,
        updatedAt: new Date().toISOString(),
      });
      setProfileForm((prev) => (prev ? { ...prev, avatarUrl: downloadUrl } : prev));
      setProfileSnapshot((prev) => (prev ? { ...prev, avatarUrl: downloadUrl } : prev));
      setNotice('Profile photo updated.');
    } catch {
      setError('Unable to upload profile photo.');
    } finally {
      setAvatarUploading(false);
    }
  };

  if (!canViewProfile) {
    return (
      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-sm text-muted">You do not have permission to view your profile.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Profile</p>
        <h1 className="font-display text-3xl text-text">Account details</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Manage your personal details, profile photo, and security settings.
        </p>
      </div>

      {loading || !profileForm ? (
        <div className="rounded-[28px] border border-border/60 bg-bg/70 p-6 text-sm text-muted">
          Loading profile...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="rounded-[28px] border border-border/60 bg-bg/70 p-6 shadow-soft">
            <div className="flex items-center gap-4">
              {profileForm.avatarUrl ? (
                <Image
                  src={profileForm.avatarUrl}
                  alt="Profile"
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded-2xl object-cover"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-2xl bg-surface-strong text-xl font-semibold text-text">
                  {(profileForm.fullName || user?.fullName || 'U').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Profile photo
                </p>
                <p className="mt-1 text-sm text-text">JPG/PNG up to 2MB, auto optimized.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  handleAvatarUpload(file);
                }}
              />
              <button
                type="button"
                disabled={!canEditAvatar || avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                className="rounded-full border border-border/60 bg-surface/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {avatarUploading ? 'Uploading...' : 'Upload photo'}
              </button>
              <button
                type="button"
                disabled={!canResetPassword}
                onClick={handlePasswordReset}
                className="rounded-full border border-border/60 bg-bg/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send reset link
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-bg/70 p-6 shadow-soft">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Full name
                </label>
                <input
                  value={profileForm.fullName}
                  onChange={(event) =>
                    setProfileForm((prev) =>
                      prev ? { ...prev, fullName: event.target.value } : prev,
                    )
                  }
                  disabled={!canEditName}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(event) =>
                    setProfileForm((prev) => (prev ? { ...prev, email: event.target.value } : prev))
                  }
                  disabled={!canEditEmail}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Phone
                </label>
                <input
                  value={profileForm.phone}
                  onChange={(event) =>
                    setProfileForm((prev) => (prev ? { ...prev, phone: event.target.value } : prev))
                  }
                  disabled={!canEditPhone}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Role
                </label>
                <input
                  value={profileForm.role}
                  onChange={(event) =>
                    setProfileForm((prev) => (prev ? { ...prev, role: event.target.value } : prev))
                  }
                  disabled={!canEditRole}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none disabled:cursor-not-allowed disabled:text-muted/70"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Status
                </label>
                <input
                  value={profileForm.active ? 'Active' : 'Inactive'}
                  readOnly
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Created
                </label>
                <input
                  value={formatDate(profileForm.createdAt)}
                  readOnly
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-muted"
                />
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                {notice}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
