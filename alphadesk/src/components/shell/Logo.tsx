import Image from 'next/image';
import { cn } from '@/lib/utils';

export const APP_NAME = 'NidhikshDesk';

export function Logo({ size = 26, showName = true, className }: { size?: number; showName?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Image src="/nidhiksh-logo.png" alt="" width={size} height={size} className="rounded-sm" priority />
      {showName && <span className="text-sm font-semibold tracking-tight">Nidhiksh<span className="text-accent">Desk</span></span>}
      <span className="sr-only">{APP_NAME}</span>
    </span>
  );
}
