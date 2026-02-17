type PublicRuntimeConfig = {
  NEXT_PUBLIC_FIREBASE_API_KEY?: string;
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  NEXT_PUBLIC_FIREBASE_APP_ID?: string;
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
  NEXT_PUBLIC_FIREBASE_VAPID_KEY?: string;
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS?: string;
};

type RuntimeGlobal = typeof globalThis & {
  __HS_RUNTIME_CONFIG__?: PublicRuntimeConfig;
};

const getRuntimeConfig = (): PublicRuntimeConfig =>
  ((globalThis as RuntimeGlobal).__HS_RUNTIME_CONFIG__ ?? {}) as PublicRuntimeConfig;

export const getPublicEnv = (key: keyof PublicRuntimeConfig) => {
  const runtimeValue = getRuntimeConfig()[key];
  if (typeof runtimeValue === 'string' && runtimeValue.length > 0) {
    return runtimeValue;
  }
  const staticValue = process.env[key];
  if (typeof staticValue === 'string') {
    return staticValue;
  }
  return '';
};

export const firebaseConfig = {
  apiKey: getPublicEnv('NEXT_PUBLIC_FIREBASE_API_KEY'),
  authDomain: getPublicEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: getPublicEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: getPublicEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getPublicEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getPublicEnv('NEXT_PUBLIC_FIREBASE_APP_ID'),
  measurementId: getPublicEnv('NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID'),
};

export const shouldUseEmulators = () => getPublicEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS') === 'true';

export const isFirebaseConfigured = () => {
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.messagingSenderId,
    firebaseConfig.appId,
  ];
  return required.every((value) => value.length > 0);
};
