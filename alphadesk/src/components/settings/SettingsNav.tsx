'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SettingsSection { id: string; label: string }

/** Left sub-nav (sticky on desktop, horizontal scroll on mobile). Highlights the section in view; links are #anchors. */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = React.useState(sections[0]?.id);
  React.useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1); if (h && sections.some((s) => s.id === h)) setActive(h); };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: '-15% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => { io.disconnect(); window.removeEventListener('hashchange', fromHash); };
  }, [sections]);
  return (
    <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`} onClick={() => setActive(s.id)} aria-current={active === s.id ? 'true' : undefined}
              className={cn(
                'block whitespace-nowrap rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info',
                active === s.id ? 'bg-panel-2 font-medium text-text md:shadow-[inset_2px_0_0_rgb(var(--accent))]' : 'text-muted hover:bg-panel-2/60 hover:text-text',
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
