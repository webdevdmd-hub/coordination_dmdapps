import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import {
  Firestore,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

import {
  getFirebaseConfig,
  isFirebaseConfigured,
  shouldUseEmulators,
} from '@/frameworks/firebase/config';

let firebaseApp: FirebaseApp | null = null;
let firebaseDb: Firestore | null = null;
let firebaseAuth: Auth | null = null;
let authPersistencePromise: Promise<void> | null = null;
let emulatorsConnected = false;

const getApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Check env variables.');
  }
  firebaseApp = getApps().length ? getApps()[0] : initializeApp(getFirebaseConfig());
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
  if (firebaseAuth) {
    return firebaseAuth;
  }
  const auth = getAuth(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(auth, getFirebaseDb());
  }
  firebaseAuth = auth;
  return firebaseAuth;
};

export const ensureFirebaseAuthPersistence = async () => {
  if (typeof window === 'undefined') {
    return;
  }
  if (!authPersistencePromise) {
    authPersistencePromise = setPersistence(getFirebaseAuth(), browserLocalPersistence).catch(
      (error) => {
        authPersistencePromise = null;
        throw error;
      },
    );
  }
  await authPersistencePromise;
};

export const getFirebaseDb = () => {
  if (firebaseDb) {
    return firebaseDb;
  }
  // Mitigate flaky QUIC/WebChannel transport errors on some networks/browsers.
  firebaseDb = initializeFirestore(getApp(), {
    experimentalAutoDetectLongPolling: true,
  });
  const firestore = firebaseDb ?? getFirestore(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(getAuth(getApp()), firestore);
  }
  return firestore;
};

export const getFirebaseStorage = () => {
  const storage = getStorage(getApp());
  if (shouldUseEmulators()) {
    connectEmulators(getAuth(getApp()), getFirebaseDb());
  }
  return storage;
};
