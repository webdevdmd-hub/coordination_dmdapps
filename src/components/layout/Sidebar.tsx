import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { NavIcon } from '@/components/icons/NavIcons';
import { NotificationSidebar } from '@/components/notifications/NotificationSidebar';
import { navigation } from '@/config/navigation';
import { PermissionKey } from '@/core/entities/permissions';
import { signOutUser } from '@/frameworks/firebase/auth';
import { hasPermission } from '@/lib/permissions';

type SidebarProps = {
  activeItem?: string;
  permissions?: PermissionKey[];
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ activeItem, permissions = [], open, onClose }: SidebarProps) {
  const router = useRouter();
  const collapsibleSections = useMemo(
    () => new Set(['Admin', 'CRM', 'Operations', 'Sales', 'Accounts']),
    [],
  );
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navigation.forEach((section) => {
      if (collapsibleSections.has(section.title)) {
        initial[section.title] = section.items.some((item) => item.label === activeItem);
      }
    });
    return initial;
  });

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await signOutUser();
      onClose();
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="primary-navigation"
        className={`fixed left-0 top-0 z-40 flex h-screen w-80 flex-col border-r border-border/60 bg-surface/90 px-6 py-6 shadow-2xl backdrop-blur transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative flex items-center justify-center">
          <Image
            src="/dmd-logo.svg"
            alt="DMD logo"
            width={155}
            height={55}
            priority
            className="h-20 w-46"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-0 rounded-full border border-border/60 bg-surface/70 p-2 text-muted transition hover:bg-hover/70 hover:text-text"
            aria-label="Close navigation"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-8 flex min-h-0 flex-1 flex-col gap-7 text-sm">
          <div className="flex-1 space-y-7 overflow-y-auto pr-1">
            {navigation.map((section) => {
              const visibleItems = section.items.filter((item) =>
                hasPermission(permissions, item.permissions),
              );
              if (visibleItems.length === 0) {
                return null;
              }
              const isCollapsible = collapsibleSections.has(section.title);
              const isExpanded =
                openSections[section.title] ??
                section.items.some((item) => item.label === activeItem);
              return (
                <div key={section.title}>
                  {isCollapsible ? (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.title)}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.28em] text-muted transition hover:bg-hover/70 hover:text-text"
                        aria-expanded={isExpanded}
                        aria-controls={`section-${section.title}`}
                      >
                        <span>{section.title}</span>
                        <svg
                          viewBox="0 0 20 20"
                          className={`h-4 w-4 transition ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 7.5l5 5 5-5" />
                        </svg>
                      </button>
                      <div
                        id={`section-${section.title}`}
                        className={`mt-2 space-y-1 pl-3 ${isExpanded ? 'block' : 'hidden'}`}
                      >
                        {visibleItems.map((item) => {
                          const isActive = item.label === activeItem;
                          return (
                            <Link
                              key={item.label}
                              href={item.href}
                              onClick={onClose}
                              className={`lift-hover flex items-center justify-between rounded-xl px-3 py-2 transition ${
                                isActive
                                  ? 'bg-accent/70 text-text shadow-soft'
                                  : 'text-muted hover:bg-hover/70 hover:text-text'
                              }`}
                            >
                              <span className="flex items-center gap-3 font-medium">
                                <NavIcon name={item.icon} className="h-4 w-4" />
                                {item.label}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      {section.title !== 'Tasks' ? (
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted">
                          {section.title}
                        </p>
                      ) : null}
                      <div className="space-y-1">
                        {visibleItems.map((item) => {
                          const isActive = item.label === activeItem;
                          return (
                            <Link
                              key={item.label}
                              href={item.href}
                              onClick={onClose}
                              className={`lift-hover flex items-center justify-between rounded-xl px-3 py-2 transition ${
                                isActive
                                  ? 'bg-accent/70 text-text shadow-soft'
                                  : 'text-muted hover:bg-hover/70 hover:text-text'
                              }`}
                            >
                              <span className="flex items-center gap-3 font-medium">
                                <NavIcon name={item.icon} className="h-4 w-4" />
                                {item.label}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {open ? <NotificationSidebar /> : null}

          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex items-center justify-center gap-3 rounded-2xl border border-border/60 bg-gradient-to-br from-surface via-surface-strong/60 to-accent/30 px-4 py-3 text-sm font-semibold text-text transition hover:bg-hover/70 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <NavIcon name="logout" className="h-4 w-4" />
            {isLoggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </aside>
    </>
  );
}
