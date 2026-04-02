'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { UserRole } from '@/core/entities/user';
import {
  clearServerSession,
  establishServerSession,
  signOutUser,
} from '@/frameworks/firebase/auth';
import {
  ensureFirebaseAuthPersistence,
  getFirebaseAuth,
  getFirebaseDb,
} from '@/frameworks/firebase/client';
import { isFirebaseConfigured } from '@/frameworks/firebase/config';
import {
  INACTIVITY_TIMEOUT_MS,
  SESSION_ACTIVITY_STORAGE_KEY,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_REFRESH_STORAGE_KEY,
} from '@/lib/auth/sessionPolicy';
import { normalizeRoleRelations, RoleRelations } from '@/lib/roleVisibility';

type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  permissions: PermissionKey[];
  roleRelations?: RoleRelations;
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
              : item === 'lead_view_department'
                ? 'lead_view_same_role'
                : item === 'calendar_view_department'
                  ? 'calendar_view_same_role'
                  : item === 'task_view_department'
                    ? 'task_view_same_role'
                    : item === 'customer_view_department'
                      ? 'customer_view_same_role'
                      : item === 'project_view_department'
                        ? 'project_view_same_role'
                        : item === 'quotation_view_department'
                          ? 'quotation_view_same_role'
                          : item === 'quotation_request_view_department'
                            ? 'quotation_request_view_same_role'
                            : item;
    if (permissionSet.has(normalized as PermissionKey)) {
      acc.push(normalized as PermissionKey);
    }
    return acc;
  }, []);
};

const getRoleAccess = async (
  roleKey: string,
): Promise<{ permissions: PermissionKey[]; roleRelations?: RoleRelations }> => {
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
      roleRelations?: unknown;
    };
    if (data.key === 'admin') {
      return { permissions: ALL_PERMISSIONS };
    }
    return {
      permissions: toPermissions(data.permissions),
      roleRelations: normalizeRoleRelations(data.roleRelations),
    };
  }

  const docSnap = await getDoc(doc(db, 'roles', roleKey));
  if (!docSnap.exists()) {
    return { permissions: [] };
  }
  const data = docSnap.data() as {
    permissions?: PermissionKey[];
    key?: string;
    roleRelations?: unknown;
  };
  if (data.key === 'admin') {
    return { permissions: ALL_PERMISSIONS };
  }
  return {
    permissions: toPermissions(data.permissions),
    roleRelations: normalizeRoleRelations(data.roleRelations),
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
    permissions: isAdmin ? ALL_PERMISSIONS : Array.from(new Set(rolePermissions)),
    roleRelations: isAdmin ? undefined : roleAccess.roleRelations,
    active,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionsSyncedAt, setPermissionsSyncedAt] = useState<number | null>(null);
  const isSigningOutRef = useRef(false);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setUser(null);
      setLoading(false);
      setPermissionsSyncedAt(null);
      return;
    }
    const auth = getFirebaseAuth();
    let mounted = true;
    let unsubscribe = () => {};

    void (async () => {
      try {
        await ensureFirebaseAuthPersistence();
      } catch {
        // Keep auth boot resilient even when persistence setup is blocked.
      }

      if (!mounted) {
        return;
      }

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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
    })();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      return;
    }
    const auth = getFirebaseAuth();
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (!isSigningOutRef.current) {
          await clearServerSession();
        }
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

  useEffect(() => {
    if (typeof window === 'undefined' || !user) {
      return;
    }

    const markActivity = () => {
      window.localStorage.setItem(SESSION_ACTIVITY_STORAGE_KEY, String(Date.now()));
    };

    markActivity();

    const events: Array<keyof WindowEventMap> = [
      'click',
      'keydown',
      'mousemove',
      'scroll',
      'touchstart',
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, markActivity, { passive: true }),
    );

    const interval = window.setInterval(() => {
      const lastActivity = Number(window.localStorage.getItem(SESSION_ACTIVITY_STORAGE_KEY) ?? '0');
      if (
        !lastActivity ||
        Date.now() - lastActivity < INACTIVITY_TIMEOUT_MS ||
        isSigningOutRef.current
      ) {
        return;
      }

      isSigningOutRef.current = true;
      void signOutUser().finally(() => {
        isSigningOutRef.current = false;
      });
    }, 60_000);

    return () => {
      events.forEach((eventName) =>
        window.removeEventListener(eventName, markActivity as EventListener),
      );
      window.clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user) {
      return;
    }

    const interval = window.setInterval(() => {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      const lastRefresh = Number(window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY) ?? '0');

      if (!currentUser || isSigningOutRef.current) {
        return;
      }

      if (lastRefresh && Date.now() - lastRefresh < SESSION_REFRESH_INTERVAL_MS) {
        return;
      }

      void currentUser
        .getIdToken(true)
        .then((idToken) => establishServerSession(idToken))
        .catch(() => clearServerSession());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [user]);

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
