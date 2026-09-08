import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRO Checker — AI CRO Health Check',
  description: 'Turn one website URL into an evidence-backed CRO health check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="/">
              CRO <span>Checker</span>
            </a>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
