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
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className={`${nunito.variable} antialiased`}>
        <ThemeProvider>
          <ModalScrollLock />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
