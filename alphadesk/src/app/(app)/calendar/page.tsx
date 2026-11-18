import type { Metadata } from 'next';
import { requireSessionUser } from '@/lib/auth';
import { screenRepo } from '@/lib/repos';
import { getCalendarEvents } from '@/lib/calendar';
import { addDays, startOfWeek, todayET } from '@/lib/calendar/dates';
import { PageHeader } from '@/components/shell/PageHeader';
import { CalendarView } from '@/components/calendar/CalendarView';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const user = await requireSessionUser();
  const wl = await screenRepo.getWatchlist({ orgId: user.orgId, userId: user.id });
  const watchlist = wl?.symbols ?? [];
  const today = todayET();
  const { events, meta } = await getCalendarEvents({
    from: startOfWeek(today),
    to: addDays(today, 90),
    watchlist,
    earningsScope: 'all',
  });
  return (
    <div className="page-enter">
      <PageHeader
        title="Calendar"
        description="Earnings for your watchlist plus the macro dates that move markets: inflation, jobs, the Fed and growth — next 90 days."
      />
      <CalendarView events={events} today={meta.today} watchlist={watchlist} sources={meta.sources} />
    </div>
  );
}
