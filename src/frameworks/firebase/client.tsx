import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

import {
  firebaseConfig,
  isFirebaseConfigured,
  shouldUseEmulators,
} from '@/frameworks/firebase/config';

let firebaseApp: FirebaseApp | null = null;
let emulatorsConnected = false;

const getApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Check env variables.');
  }
  firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return firebaseApp;
};

export const getFirebaseApp = () => getApp();

const connectEmulators = (auth: Auth, firestore: Firestore) => {
  if (emulatorsConnected) {
    return;
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectStorageEmulator(getStorage(getApp()), '127.0.0.1', 9199);
  emulatorsConnected = true;
};

export const getFirebaseAuth = () => {
  const auth = getAuth(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(auth, getFirestore(getApp()));
  }
  return auth;
};

export const getFirebaseDb = () => {
  const firestore = getFirestore(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(getAuth(getApp()), firestore);
  }
  return firestore;
};

export const getFirebaseStorage = () => {
  const storage = getStorage(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(getAuth(getApp()), getFirestore(getApp()));
  }
  return storage;
};
