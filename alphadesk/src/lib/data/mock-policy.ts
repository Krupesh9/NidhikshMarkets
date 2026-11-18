/**
 * Whether the deterministic Mock provider may serve data.
 *   - ALLOW_MOCK_DATA=1 → always on; ALLOW_MOCK_DATA=0 → always off
 *   - otherwise: OFF (development and production show only real data); on only under the test runner
 *   - ALPHADESK_FORCE_MOCK=1 (demos/CI) implies on.
 * Pure function of the env so it is unit-testable.
 */
export function mockAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ALPHADESK_FORCE_MOCK === '1') return true;
  if (env.ALLOW_MOCK_DATA === '1' || env.ALLOW_MOCK_DATA === 'true') return true;
  if (env.ALLOW_MOCK_DATA === '0' || env.ALLOW_MOCK_DATA === 'false') return false;
  return env.NODE_ENV === 'test';
}
