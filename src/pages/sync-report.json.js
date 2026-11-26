import report from '../data/generated/sync-report.json';
// Read-only status of the last feed sync, for checking matches after a deploy. Remove before launch if not wanted.
export function GET() {
  return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
