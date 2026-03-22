import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Jobbie - Job Listing Aggregator',
  description: 'Aggregated job listings from multiple sources, filtered to your preferences',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
