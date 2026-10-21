import type { Metadata } from 'next';
import { DM_Mono, Figtree } from 'next/font/google';
import { Provider } from '@/components/provider';
import './global.css';

// the studio uses figtree and dm mono, keep the docs in the same type
const sans = Figtree({ subsets: ['latin'], variable: '--font-figtree' });
const mono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-dm-mono' });

export const metadata: Metadata = {
  title: { template: '%s | Sluby docs', default: 'Sluby docs' },
  description: 'Documentation for Sluby, the self-hosted video platform that stores media on Sia.',
  icons: { icon: '/favicon.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
