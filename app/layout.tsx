import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import HeroHeaderGate from '@/components/HeroHeaderGate';
import { AuthProvider } from '@/components/auth/AuthProvider';
// import { WalletProvider } from '@/components/web3/WalletProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });

export const metadata: Metadata = {
  title: {
    default: 'Ginie — Build, Deploy and Scale with AI',
    template: '%s | Ginie',
  },
  description:
    'Ginie helps you generate, deploy and manage smart contracts, pipelines and AI-powered workflows — fast, secure and production‑ready.',
  keywords:
    'Ginie, AI, smart contracts, deployment, pipelines, web3, grants, jobs, developers, generate, deploy',
  authors: [{ name: 'Ginie' }],
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Ginie — Build, Deploy and Scale with AI',
    description:
      'Generate and deploy contracts, jobs and pipelines with Ginie’s AI‑driven toolkit.',
    url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100',
    siteName: 'Ginie',
    images: [
      {
        url: `${siteUrl}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: 'Ginie — Build, Deploy and Scale with AI',
      },
      { url: `${siteUrl}/favicon-32x32.png`, width: 32, height: 32, alt: 'favicon' },
      { url: `${siteUrl}/favicon-16x16.png`, width: 16, height: 16, alt: 'favicon' },
      { url: `${siteUrl}/android-chrome-192x192.png`, width: 192, height: 192, alt: 'android chrome' },
      { url: `${siteUrl}/android-chrome-512x512.png`, width: 512, height: 512, alt: 'android chrome' },
      { url: `${siteUrl}/apple-touch-icon.png`, width: 180, height: 180, alt: 'apple touch icon' },
      { url: `${siteUrl}/favicon.ico`, width: 48, height: 48, alt: 'favicon ico' },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ginie — Build, Deploy and Scale with AI',
    description: 'AI‑driven generation and deployment toolkit.',
    images: [
      `${siteUrl}/opengraph-image`,
      `${siteUrl}/favicon-32x32.png`,
      `${siteUrl}/android-chrome-512x512.png`,
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased  text-foreground overflow-x-hidden`} suppressHydrationWarning>
          <AuthProvider>
            <HeroHeaderGate />
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
            <Toaster />
          </AuthProvider>
      </body>
    </html>
  );
}