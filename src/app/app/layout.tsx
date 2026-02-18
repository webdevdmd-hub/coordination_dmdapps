import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { NotificationProvider } from '@/components/notifications/NotificationProvider';
import { TaskModalProvider } from '@/components/tasks/TaskModalProvider';
import { getFirebaseAdminAuth } from '@/frameworks/firebase/admin';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/sessionCookie';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    redirect('/login');
  }

  try {
    await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
  } catch {
    redirect('/login');
  }

  return (
    <AuthProvider>
      <NotificationProvider>
        <TaskModalProvider>
          <AppShell>{children}</AppShell>
        </TaskModalProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}
