import site from '../data/site.json';
import guestsData from '../data/guests.json';
import partners from '../data/partners.json';
import overrides from '../data/episode-overrides.json';
import rawEpisodes from '../data/generated/episodes.json';
import rawVideos from '../data/generated/videos.json';

export { site, partners };

export const slugify = (s = '') =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'"“”]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function durationLabel(sec) {
  if (!sec) return null;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h && m === 60) return `${h + 1} hr`;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}
export function clockLabel(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export const formatDate = (d) =>
  d ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

function htmlToLines(html = '') {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z]+;/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean);
}
const CHAPTER = /^\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.+)$/;
const toSeconds = (t) => t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
function parseDescription(html) {
  const lines = htmlToLines(html);
  const chapters = [], paras = [];
  for (const l of lines) {
    const m = l.match(CHAPTER);
    if (m) chapters.push({ time: m[1], seconds: toSeconds(m[1]), title: m[2] });
    else if (l.length > 50 && !/https?:\/\/|^(subscribe|follow|instagram|tiktok)\b/i.test(l)) paras.push(l);
  }
  return { chapters: chapters.length >= 2 ? chapters : [], paragraphs: paras };
}

export const guests = guestsData.map((g) => ({ ...g, slug: slugify(g.name) }));

export const episodes = rawEpisodes
  .map((e) => {
    const o = overrides[e.slug] || (e.number ? overrides['#' + e.number] : null) || {};
    const ep = { topics: [], era: null, guests: [], thumbPosition: 'center', ...e, ...o };
    const parsed = parseDescription(e.descriptionHtml);
    if (!o.guests) {
      const t = e.title.toLowerCase();
      const esc = (n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ep.guests = guestsData.map((g) => g.name).filter((n) => {
        const x = esc(n);
        return new RegExp(`^(the )?${x}\\b|\\b(with|w/|featuring|feat\\.) (\\S+ )?${x}\\b|[&+] ${x}\\b|\\b${x} [&+]`).test(t);
      });
    }
    ep.chapters = parsed.chapters;
    ep.summaryParagraphs = parsed.paragraphs;
    ep.summary = e.summary || parsed.paragraphs[0] || '';
    ep.thumb = o.thumb || (e.youtubeId ? `https://i.ytimg.com/vi/${e.youtubeId}/mqdefault.jpg` : e.image) || null;
    ep.href = `/episodes/${ep.slug}/`;
    ep.displayTitle = o.shortTitle || ep.title;
    ep.durationText = durationLabel(ep.duration);
    ep.guestText = ep.guests.length ? `With ${ep.guests.join(' and ')}` : '';
    ep.numberText = ep.number ? `Ep. ${ep.number}` : '';
    ep.links = {
      youtube: ep.youtube || site.links.youtube,
      spotify: ep.spotify || site.links.spotify,
      apple: ep.apple || site.links.apple,
    };
    return ep;
  })
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

export const featured =
  (site.featuredEpisode && episodes.find((e) => e.slug === site.featuredEpisode)) || episodes[0];

export const videos = rawVideos
  .map((v) => ({ ...v, runtime: clockLabel(v.duration) }))
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

export function episodesForGuest(name) {
  return episodes.filter((e) => e.guests.includes(name));
}

export const ERAS = ['1967 to 1979', '1980s', '1990s', '2000 to 2008', 'The return'];
export const topics = [...new Set(episodes.flatMap((e) => e.topics))].sort();
