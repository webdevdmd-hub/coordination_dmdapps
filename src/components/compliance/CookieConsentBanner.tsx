'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';

import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/auth/sessionPolicy';

type ConsentStatus = 'accepted' | 'declined';

type CookiePreferences = {
  essential: true;
  preferences: boolean;
  analytics: boolean;
  status: ConsentStatus;
  updatedAt: number;
};

const defaultPreferences = {
  essential: true,
  preferences: true,
  analytics: false,
} as const;

const parseStoredConsent = (rawValue: string | null): CookiePreferences | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CookiePreferences>;
    return {
      essential: true,
      preferences: Boolean(parsed.preferences),
      analytics: Boolean(parsed.analytics),
      status: parsed.status === 'accepted' ? 'accepted' : 'declined',
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
};

const getStoredConsentSnapshot = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
};

const persistConsent = (preferences: CookiePreferences) => {
  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event('cookie-consent-change'));
};

const subscribeToConsent = (onStoreChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== COOKIE_CONSENT_STORAGE_KEY) {
      return;
    }
    onStoreChange();
  };

  const handleConsentChange = () => {
    onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener('cookie-consent-change', handleConsentChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('cookie-consent-change', handleConsentChange);
  };
};

export function CookieConsentBanner() {
  const storedConsentRaw = useSyncExternalStore(
    subscribeToConsent,
    getStoredConsentSnapshot,
    () => null,
  );
  const storedConsent = useMemo(() => parseStoredConsent(storedConsentRaw), [storedConsentRaw]);
  const [showDetails, setShowDetails] = useState(false);

  if (storedConsent) {
    return null;
  }

  const savePreferences = (status: ConsentStatus, nextPreferences = defaultPreferences) => {
    const consent: CookiePreferences = {
      essential: true,
      preferences: nextPreferences.preferences,
      analytics: nextPreferences.analytics,
      status,
      updatedAt: Date.now(),
    };
    persistConsent(consent);
    setShowDetails(false);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      <section className="animate-popup-corner pointer-events-auto w-[min(100vw-1.5rem,348px)] rounded-[22px] border border-border/70 bg-surface/98 px-4 py-4 text-text shadow-[0_20px_50px_rgba(15,23,42,0.14)] backdrop-blur">
        <p className="max-w-[272px] text-[14px] leading-[1.55] sm:text-[15px]">
          We use cookies to improve your experience on our site. By using our site, you consent to
          cookies.{' '}
          <button
            type="button"
            onClick={() => setShowDetails((current) => !current)}
            className="font-extrabold text-accent underline decoration-transparent underline-offset-2 transition hover:decoration-accent"
          >
            Learn more
          </button>
        </p>

        {showDetails ? (
          <div className="mt-3 rounded-2xl border border-border/60 bg-surface-soft p-3 text-[12px] leading-5 text-muted">
            <p>
              Continue where you left off with essential session cookies that keep your login secure
              across visits.
            </p>
            <p className="mt-2">
              Declining keeps only essential cookies required for secure sign-in and protected
              routes.
            </p>
          </div>
        ) : null}

        <div className="mt-4 space-y-2.5">
          <button
            type="button"
            onClick={() =>
              savePreferences('accepted', {
                essential: true,
                preferences: true,
                analytics: true,
              })
            }
            className="block w-full rounded-[14px] bg-accent px-4 py-3 text-center text-[15px] font-bold text-white transition hover:bg-accent-strong"
          >
            Allow Cookies
          </button>

          <button
            type="button"
            onClick={() =>
              savePreferences('declined', {
                essential: true,
                preferences: false,
                analytics: false,
              })
            }
            className="block w-full rounded-[14px] border border-border bg-surface px-4 py-3 text-center text-[15px] font-bold text-text transition hover:bg-surface-soft"
          >
            Decline
          </button>
        </div>
      </section>
    </div>
  );
}
