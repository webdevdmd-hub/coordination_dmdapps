import { signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { getFirebaseAuth } from '@/frameworks/firebase/client';
export const signInWithEmail = async (email: string, password: string) => {
  const auth = getFirebaseAuth();
  return signInWithEmailAndPassword(auth, email, password);
};

export const signOutUser = async () => {
  const auth = getFirebaseAuth();
  return signOut(auth);
};
