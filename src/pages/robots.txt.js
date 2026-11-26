import { site } from '../lib/content.js';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /sync-report.json\n\nSitemap: ${new URL('/sitemap.xml', site.url).href}\n`, { headers: { 'Content-Type': 'text/plain' } });
}
