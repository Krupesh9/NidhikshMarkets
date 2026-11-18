import Link from 'next/link';
import Image from 'next/image';
import { Compass } from 'lucide-react';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md text-center">
        <Image src="/nidhiksh-logo.png" alt="" width={48} height={48} className="mx-auto rounded-lg" />
        <p className="eyebrow mt-6">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-muted">The link may be broken, or the page may have moved. Check the address, or head back to your dashboard.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/dashboard" className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
            <Compass className="h-4 w-4" aria-hidden /> Go to dashboard
          </Link>
        </div>
        <p className="mt-10 text-[11px] text-muted">Nidhiksh <span className="text-accent">Pulse</span> · Research only — not investment advice.</p>
      </div>
    </main>
  );
}
