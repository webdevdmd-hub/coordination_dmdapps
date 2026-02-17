'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { UserRole } from '@/core/entities/user';
import { getFirebaseAuth, getFirebaseDb } from '@/frameworks/firebase/client';

type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  permissions: PermissionKey[];
  active: boolean;
};

type AuthContextValue = {
  user: UserProfile | null;
  permissions: PermissionKey[];
  loading: boolean;
  permissionsSyncedAt: number | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const permissionSet = new Set(ALL_PERMISSIONS);

const toPermissions = (value: unknown): PermissionKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is PermissionKey =>
      typeof item === 'string' && permissionSet.has(item as PermissionKey),
  );
};

const getRolePermissions = async (roleKey: string): Promise<PermissionKey[]> => {
  if (!roleKey) {
    return [];
  }
  if (roleKey === 'admin') {
    return ALL_PERMISSIONS;
  }
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(collection(db, 'roles'), where('key', '==', roleKey)));
  if (!snapshot.empty) {
    const data = snapshot.docs[0]?.data() as { permissions?: PermissionKey[]; key?: string };
    if (data.key === 'admin') {
      return ALL_PERMISSIONS;
    }
    return toPermissions(data.permissions);
  }

  const docSnap = await getDoc(doc(db, 'roles', roleKey));
  if (!docSnap.exists()) {
    return [];
  }
  const data = docSnap.data() as { permissions?: PermissionKey[]; key?: string };
  if (data.key === 'admin') {
    return ALL_PERMISSIONS;
  }
  return toPermissions(data.permissions);
};

const toUserProfile = async (firebaseUser: FirebaseUser): Promise<UserProfile | null> => {
  const db = getFirebaseDb();
  const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
  if (!snap.exists()) {
    return null;
  }

  const data = snap.data();
  const rawRole = typeof data.role === 'string' ? data.role : 'agent';
  const roleKey = rawRole.trim().toLowerCase();
  const rolePermissions = await getRolePermissions(roleKey);
  const isAdmin = roleKey === 'admin' || rolePermissions.includes('admin');
  const role = (isAdmin ? 'admin' : rawRole) as UserRole;
  const fullName = typeof data.fullName === 'string' ? data.fullName : 'User';
  const email = typeof data.email === 'string' ? data.email : (firebaseUser.email ?? '');
  const phone = typeof data.phone === 'string' ? data.phone : '';
  const avatarUrl = typeof data.avatarUrl === 'string' ? data.avatarUrl : '';
  const active = Boolean(data.active ?? true);
  return {
    id: snap.id,
    fullName,
    email,
    phone,
    avatarUrl,
    role,
    permissions: isAdmin ? ALL_PERMISSIONS : Array.from(new Set(rolePermissions)),
    active,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionsSyncedAt, setPermissionsSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        setPermissionsSyncedAt(null);
        return;
      }

      try {
        const profile = await toUserProfile(firebaseUser);
        setUser(profile);
        setPermissionsSyncedAt(Date.now());
      } catch {
        setUser(null);
        setPermissionsSyncedAt(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const value = useMemo(() => {
    const permissions = user?.permissions ?? [];
    return {
      user,
      permissions,
      loading,
      permissionsSyncedAt,
    };
  }, [user, loading, permissionsSyncedAt]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
};
