import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { getFirebaseAuth } from '@/frameworks/firebase/client';

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
    throw new Error('Unable to synchronize authentication session.');
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  const auth = getFirebaseAuth();
  return signInWithEmailAndPassword(auth, email, password);
};

export const establishServerSession = async (idToken: string) => {
  await syncServerSession('POST', idToken);
};

export const clearServerSession = async () => {
  try {
    await syncServerSession('DELETE');
  } catch {
    // Keep sign-out flow resilient even if cookie cleanup fails.
  }
};

export const signOutUser = async () => {
  const auth = getFirebaseAuth();
  try {
    await signOut(auth);
  } finally {
    await clearServerSession();
  }
};
