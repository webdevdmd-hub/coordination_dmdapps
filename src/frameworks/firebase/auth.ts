import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { ensureFirebaseAuthPersistence, getFirebaseAuth } from '@/frameworks/firebase/client';
import { isFirebaseConfigured } from '@/frameworks/firebase/config';
import { SESSION_REFRESH_STORAGE_KEY } from '@/lib/auth/sessionPolicy';

const syncServerSession = async (method: 'POST' | 'DELETE', idToken?: string) => {
  const response = await fetch('/api/auth/session', {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: method === 'POST' ? JSON.stringify({ idToken }) : undefined,
  });

  if (!response.ok) {
    let errorMessage = 'Unable to synchronize authentication session.';
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        errorMessage = payload.error;
      }
    } catch {
      // Fall back to the generic message when the response is not JSON.
    }
    throw new Error(errorMessage);
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Check env variables.');
  }
  await ensureFirebaseAuthPersistence();
  const auth = getFirebaseAuth();
  return signInWithEmailAndPassword(auth, email, password);
};

export const establishServerSession = async (idToken: string) => {
  await syncServerSession('POST', idToken);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SESSION_REFRESH_STORAGE_KEY, String(Date.now()));
  }
};

export const clearServerSession = async () => {
  try {
    await syncServerSession('DELETE');
  } catch {
    // Keep sign-out flow resilient even if cookie cleanup fails.
  } finally {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_REFRESH_STORAGE_KEY);
    }
  }
};

export const signOutUser = async () => {
  if (!isFirebaseConfigured()) {
    await clearServerSession();
    return;
  }
  const auth = getFirebaseAuth();
  try {
    await signOut(auth);
  } finally {
    await clearServerSession();
  }
};
