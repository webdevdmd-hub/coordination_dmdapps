'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { UserRole } from '@/core/entities/user';
import { clearServerSession, establishServerSession } from '@/frameworks/firebase/auth';
import { getFirebaseAuth, getFirebaseDb } from '@/frameworks/firebase/client';
import { isFirebaseConfigured } from '@/frameworks/firebase/config';

type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  departmentId?: string;
  departmentScope?: {
    viewUsersDepartmentIds?: string[];
    assignTasksDepartmentIds?: string[];
  };
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
const fallbackAuthContext: AuthContextValue = {
  user: null,
  permissions: [],
  loading: false,
  permissionsSyncedAt: null,
};

const permissionSet = new Set(ALL_PERMISSIONS);

const toPermissions = (value: unknown): PermissionKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<PermissionKey[]>((acc, item) => {
    if (typeof item !== 'string') {
      return acc;
    }
    const normalized =
      item === 'accounts'
        ? 'sales_order'
        : item === 'po_request_create'
          ? 'sales_order_request_create'
          : item === 'po_request_view'
            ? 'sales_order_request_view'
            : item === 'po_request_approve'
              ? 'sales_order_request_approve'
              : item;
    if (permissionSet.has(normalized as PermissionKey)) {
      acc.push(normalized as PermissionKey);
    }
    return acc;
  }, []);
};

const toDepartmentIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
};

const getRoleAccess = async (
  roleKey: string,
): Promise<{
  permissions: PermissionKey[];
  departmentScope?: {
    viewUsersDepartmentIds?: string[];
    assignTasksDepartmentIds?: string[];
  };
}> => {
  if (!roleKey) {
    return { permissions: [] };
  }
  if (roleKey === 'admin') {
    return { permissions: ALL_PERMISSIONS };
  }
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(collection(db, 'roles'), where('key', '==', roleKey)));
  if (!snapshot.empty) {
    const data = snapshot.docs[0]?.data() as {
      permissions?: PermissionKey[];
      key?: string;
      departmentScope?: {
        viewUsersDepartmentIds?: unknown;
        assignTasksDepartmentIds?: unknown;
      };
    };
    if (data.key === 'admin') {
      return { permissions: ALL_PERMISSIONS };
    }
    return {
      permissions: toPermissions(data.permissions),
      departmentScope: {
        viewUsersDepartmentIds: toDepartmentIds(data.departmentScope?.viewUsersDepartmentIds),
        assignTasksDepartmentIds: toDepartmentIds(data.departmentScope?.assignTasksDepartmentIds),
      },
    };
  }

  const docSnap = await getDoc(doc(db, 'roles', roleKey));
  if (!docSnap.exists()) {
    return { permissions: [] };
  }
  const data = docSnap.data() as {
    permissions?: PermissionKey[];
    key?: string;
    departmentScope?: {
      viewUsersDepartmentIds?: unknown;
      assignTasksDepartmentIds?: unknown;
    };
  };
  if (data.key === 'admin') {
    return { permissions: ALL_PERMISSIONS };
  }
  return {
    permissions: toPermissions(data.permissions),
    departmentScope: {
      viewUsersDepartmentIds: toDepartmentIds(data.departmentScope?.viewUsersDepartmentIds),
      assignTasksDepartmentIds: toDepartmentIds(data.departmentScope?.assignTasksDepartmentIds),
    },
  };
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
  const roleAccess = await getRoleAccess(roleKey);
  const rolePermissions = roleAccess.permissions;
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
    departmentScope: isAdmin ? undefined : roleAccess.departmentScope,
    permissions: isAdmin ? ALL_PERMISSIONS : Array.from(new Set(rolePermissions)),
    active,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionsSyncedAt, setPermissionsSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setUser(null);
      setLoading(false);
      setPermissionsSyncedAt(null);
      return;
    }
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

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      return;
    }
    const auth = getFirebaseAuth();
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        await clearServerSession();
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        await establishServerSession(idToken);
      } catch {
        await clearServerSession();
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
  return context ?? fallbackAuthContext;
};
