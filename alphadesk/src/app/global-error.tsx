'use client';

/** Last-resort boundary (root layout failed): inline styles only, since globals.css may not have loaded. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0d10', color: '#e7eaee', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
        <div role="alert" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8a93a3' }}>Nidhiksh Pulse</div>
          <h1 style={{ fontSize: 22, margin: '12px 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#8a93a3', lineHeight: 1.5 }}>The app couldn&apos;t load. Please try again in a moment.</p>
          {error.digest && <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#8a93a3' }}>Reference: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ marginTop: 16, height: 36, padding: '0 16px', borderRadius: 6, border: 0, background: '#ff8a1f', color: '#111', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
