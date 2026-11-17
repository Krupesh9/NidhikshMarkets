import {test,expect} from './fixtures';
import {asOf,dateLabel} from '../lib/api';
test('display dates retain calendar days and use the requested month-day-year format',()=>{
 expect(dateLabel('2026-11-17')).toBe('Nov 17, 2026');
 expect(asOf('2026-11-17')).toBe('Nov 17, 2026');
 expect(dateLabel('2024-02-29')).toBe('Feb 29, 2024');
 expect(dateLabel('2026-02-29')).toBe('Not available');
 expect(dateLabel('invalid')).toBe('Not available');
 expect(dateLabel(null)).toBe('Not available');
 expect(dateLabel('2026-11-17T00:30:00Z')).toBe('Nov 16, 2026');
 expect(asOf('2026-11-17T20:00:00Z')).toBe('Nov 17, 2026, 3:00 PM EST');
});
