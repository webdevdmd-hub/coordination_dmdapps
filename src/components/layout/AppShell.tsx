'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/components/auth/AuthProvider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, permissions } = useAuth();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const displayName = user?.fullName ?? 'User';
  const roleLabel = user?.role ? user.role.toUpperCase() : 'Guest';

  useEffect(() => {
    if (!isNavOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNavOpen]);

  useEffect(() => {
    if (isNavOpen) {
      return;
    }
    menuButtonRef.current?.focus();
  }, [isNavOpen]);

  useEffect(() => {
    const { overflow } = document.body.style;
    if (isNavOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isNavOpen]);

  const activeItem = (() => {
    if (pathname === '/app') {
      return 'Main Dashboard';
    }
    if (pathname.startsWith('/app/admin/users')) return 'User Management';
    if (pathname.startsWith('/app/admin/roles')) return 'Role Management';
    if (pathname.startsWith('/app/crm/leads')) return 'Leads';
    if (pathname.startsWith('/app/crm/calendar')) return 'Calendar';
    if (pathname.startsWith('/app/crm/reports')) return 'Reports';
    if (pathname.startsWith('/app/tasks')) return 'Tasks';
    if (pathname.startsWith('/app/sales/customers')) return 'Customers';
    if (pathname.startsWith('/app/sales/projects')) return 'Projects';
    if (pathname.startsWith('/app/sales/quotation-requests')) return 'Quotation Requests';
    if (pathname.startsWith('/app/sales/quotations')) return 'Quotations';
    if (pathname.startsWith('/app/sales/invoices')) return 'Invoices';
    if (pathname.startsWith('/app/accounts')) return 'Accounts';
    if (pathname.startsWith('/app/store')) return 'Store';
    if (pathname.startsWith('/app/procurement')) return 'Procurement';
    if (pathname.startsWith('/app/logistics')) return 'Logistics';
    if (pathname.startsWith('/app/marketing')) return 'Marketing';
    if (pathname.startsWith('/app/compliance')) return 'Compliance';
    if (pathname.startsWith('/app/fleet')) return 'Fleet';
    if (pathname.startsWith('/app/settings')) return 'Settings';
    return undefined;
  })();

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        <Sidebar
          activeItem={activeItem}
          permissions={permissions}
          open={isNavOpen}
          onClose={() => setIsNavOpen(false)}
        />
        <div className="flex flex-1 flex-col">
          <TopBar
            userName={displayName}
            roleLabel={roleLabel}
            onMenuClick={() => setIsNavOpen((prev) => !prev)}
            isMenuOpen={isNavOpen}
            menuButtonRef={menuButtonRef}
          />
          <main className="flex-1 px-6 pb-10 pt-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
