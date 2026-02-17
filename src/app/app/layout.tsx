import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { NotificationProvider } from '@/components/notifications/NotificationProvider';
import { TaskModalProvider } from '@/components/tasks/TaskModalProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
