import type { Metadata } from 'next';
import { Inter, Lexend } from 'next/font/google';
import './globals.css';

// Self-hosted via next/font: no external request at runtime, no layout shift. Lexend for display
// text (headlines, scores) reads slightly rounder/friendlier at large sizes; Inter carries body copy
// and UI chrome, where its tighter spacing serves density.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend', display: 'swap', weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: 'CRO Checker — AI CRO Health Check',
  description: 'Turn one website URL into an evidence-backed CRO health check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lexend.variable}`}>
      <body>
        <div className="bg-aurora" aria-hidden="true" />
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 15L9 10L13 14L20 6"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M14 6H20V12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              CRO <span className="brand-accent">Checker</span>
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
