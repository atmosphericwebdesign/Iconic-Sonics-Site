import { site } from '../lib/content.js';

export function GET() {
  const pages = ['/', '/episodes/', '/videos/', '/news/', '/guests/', '/partners/'];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${new URL(p, site.url).href}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
