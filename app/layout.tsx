import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Consideration Audit — When They\'re Shopping, Do You Win?',
  description: 'Free audit that scans your law firm\'s SEO quality, content depth, local search signals, and conversion readiness — then scores how well you compete when potential clients are actively comparing firms.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
