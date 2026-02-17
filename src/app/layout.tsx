import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';

import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ModalScrollLock } from '@/components/ui/ModalScrollLock';

import './globals.css';

const nunito = Nunito({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DMD LIGHTS',
  description: 'Operations and task management for internal teams.',
  icons: {
    icon: [
      { url: '/icons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/icons/favicon-32x32.png',
    apple: '/icons/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtimePublicConfig = {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? '',
    NEXT_PUBLIC_FIREBASE_VAPID_KEY: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '',
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS ?? '',
  };
  const runtimeConfigScript = `window.__HS_RUNTIME_CONFIG__=${JSON.stringify(
    runtimePublicConfig,
  ).replace(/</g, '\\u003c')};`;

  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className={`${nunito.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript }} />
        <ThemeProvider>
          <ModalScrollLock />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
