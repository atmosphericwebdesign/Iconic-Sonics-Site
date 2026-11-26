// Pulls episodes and videos from the podcast feed, Apple, Spotify and YouTube,
// matches them up, and writes src/data/generated/*.json for the site to read.
// Safe by design: if a source fails, the last good data is kept and the build continues.
//
// Optional environment variables (set in Vercel > Settings > Environment Variables):
//   YOUTUBE_API_KEY                         enables videos and per-episode YouTube links
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET enables per-episode Spotify links
//   YT_FULL_PLAYLIST, YT_CLIPS_PLAYLIST     optional playlist ids that force a video's type

import { readFile, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const root = new URL('../', import.meta.url);
const OUT = new URL('src/data/generated/', root);
const site = JSON.parse(await readFile(new URL('src/data/site.json', root), 'utf8'));
const env = process.env;
const report = { ranAt: new Date().toISOString(), sources: {}, unmatched: { youtube: [], spotify: [], apple: [] }, notes: [] };

const log = (...a) => console.log('[sync]', ...a);
async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': 'IconicSonicsSiteSync/1.0', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  } finally { clearTimeout(t); }
}
const readJson = async (name, fallback) => { try { return JSON.parse(await readFile(new URL(name, OUT), 'utf8')); } catch { return fallback; } };
const writeJson = (name, data) => writeFile(new URL(name, OUT), JSON.stringify(data, null, 2) + '\n');

// ---------- helpers ----------
export const slugify = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'"“”]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'with', 'for', 'is', 'at', 'iconic', 'sonics', 'podcast', 'ep', 'episode', 'full']);
const tokens = (s = '') => new Set(slugify(s).split('-').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)));
const jaccard = (a, b) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
const numberIn = (s = '') => { const m = s.match(/(?:\bep(?:isode)?\.?\s*|#)(\d{1,4})\b/i); return m ? Number(m[1]) : null; };
const cleanTitle = (s = '') => s.replace(/^\s*(?:ep(?:isode)?\.?\s*|#)\d+\s*[:|\-–—]\s*/i, '').replace(/\s*[|\-–—]\s*iconic sonics(?: podcast)?\s*$/i, '').trim();
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const daysApart = (a, b) => (a && b ? Math.abs(new Date(a) - new Date(b)) / 864e5 : 99);
function parseClock(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const p = s.split(':').map(Number); if (p.some(isNaN)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}
function parseIsoDuration(iso = '') {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
// Best match for a platform item among episodes: episode number, then title words, then release date.
function match(item, episodes, { maxDays = 3 } = {}) {
  const sameDay = episodes.filter((ep) => daysApart(item.date, ep.date) <= 1);
  if (sameDay.length === 1 && jaccard(item.title, sameDay[0].title) > 0) return sameDay[0];
  let best = null, bestScore = 0;
  for (const ep of episodes) {
    let score = 0;
    const n = item.number ?? numberIn(item.title);
    if (n && ep.number && n === ep.number) score += 1;
    score += jaccard(item.title, ep.title);
    const dd = daysApart(item.date, ep.date);
    if (dd <= 1) score += 0.35; else if (dd <= maxDays) score += 0.15;
    if (score > bestScore) { bestScore = score; best = ep; }
  }
  return bestScore >= 0.6 ? best : null;
}

// ---------- 1. podcast feed (source of truth for episodes) ----------
const previous = await readJson('episodes.json', []);
let episodes = previous;
try {
  const xml = await (await get(env.SYNC_RSS_URL || site.podcast.rss)).text();
  const feed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', cdataPropName: false }).parse(xml);
  let items = feed?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  const showArt = feed?.rss?.channel?.['itunes:image']?.['@href'] || feed?.rss?.channel?.image?.url || null;
  const seen = new Set();
  episodes = items
    .filter((it) => (it['itunes:episodeType'] || 'full') !== 'trailer')
    .map((it) => {
      const raw = String(it.title ?? '').trim();
      const title = cleanTitle(raw) || raw;
      let slug = slugify(title) || slugify(String(it.guid?.['#text'] ?? it.guid ?? ''));
      while (seen.has(slug)) slug += '-2';
      seen.add(slug);
      const html = String(it['content:encoded'] ?? it.description ?? it['itunes:summary'] ?? '');
      return {
        slug,
        guid: String(it.guid?.['#text'] ?? it.guid ?? ''),
        number: Number(it['itunes:episode']) || numberIn(raw),
        season: Number(it['itunes:season']) || null,
        title,
        date: day(it.pubDate),
        duration: parseClock(it['itunes:duration']),
        descriptionHtml: html,
        summary: '',
        image: it['itunes:image']?.['@href'] || showArt,
        audio: it.enclosure?.['@url'] || null,
        youtube: null, youtubeId: null, spotify: null, apple: null,
      };
    });
  report.sources.rss = { ok: true, episodes: episodes.length };
  log(`feed: ${episodes.length} episodes`);
} catch (e) {
  report.sources.rss = { ok: false, error: String(e.message || e) };
  log('feed failed, keeping previous episodes:', e.message);
  await writeJson('sync-report.json', report);
  process.exit(0);
}

// ---------- 2. Apple Podcasts (public, no key) ----------
try {
  const r = await (await get(`https://itunes.apple.com/lookup?id=${site.podcast.appleId}&entity=podcastEpisode&limit=300`)).json();
  const items = (r.results || []).filter((x) => x.wrapperType === 'podcastEpisode');
  let hits = 0;
  for (const it of items) {
    const ep = episodes.find((e) => e.guid && it.episodeGuid && e.guid === it.episodeGuid)
      || match({ title: it.trackName, date: day(it.releaseDate) }, episodes, { maxDays: 1 });
    if (ep && !ep.apple) { ep.apple = it.trackViewUrl?.split('&uo=')[0] || it.trackViewUrl; hits++; }
    else if (!ep) report.unmatched.apple.push(it.trackName);
  }
  report.sources.apple = { ok: true, items: items.length, matched: hits };
} catch (e) { report.sources.apple = { ok: false, error: String(e.message || e) }; }

// ---------- 3. Spotify (needs client id + secret) ----------
if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
  try {
    const tok = await (await get('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64') },
      body: 'grant_type=client_credentials',
    })).json();
    let url = `https://api.spotify.com/v1/shows/${site.podcast.spotifyShowId}/episodes?market=US&limit=50`, items = [];
    while (url) {
      const page = await (await get(url, { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
      items.push(...(page.items || []).filter(Boolean)); url = page.next;
    }
    let hits = 0;
    for (const it of items) {
      const ep = match({ title: it.name, date: it.release_date }, episodes, { maxDays: 1 });
      if (ep && !ep.spotify) { ep.spotify = it.external_urls?.spotify; hits++; } else if (!ep) report.unmatched.spotify.push(it.name);
    }
    report.sources.spotify = { ok: true, items: items.length, matched: hits };
  } catch (e) { report.sources.spotify = { ok: false, error: String(e.message || e) }; }
} else report.sources.spotify = { ok: false, error: 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set; episodes link to the show page' };

// ---------- 4. YouTube (needs an API key) ----------
let videos = await readJson('videos.json', []);
if (env.YOUTUBE_API_KEY) {
  try {
    const key = env.YOUTUBE_API_KEY, api = 'https://www.googleapis.com/youtube/v3';
    const handle = site.podcast.youtubeHandle.replace(/^@/, '');
    const ch = await (await get(`${api}/channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}&key=${key}`)).json();
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('channel not found for handle ' + handle);
    const playlistIds = async (pl) => {
      const ids = []; let token = '';
      do {
        const r = await (await get(`${api}/playlistItems?part=contentDetails&maxResults=50&playlistId=${pl}&key=${key}${token ? `&pageToken=${token}` : ''}`)).json();
        ids.push(...(r.items || []).map((i) => i.contentDetails.videoId)); token = r.nextPageToken || '';
      } while (token);
      return ids;
    };
    const ids = await playlistIds(uploads);
    const forceFull = new Set(env.YT_FULL_PLAYLIST ? await playlistIds(env.YT_FULL_PLAYLIST) : []);
    const forceClip = new Set(env.YT_CLIPS_PLAYLIST ? await playlistIds(env.YT_CLIPS_PLAYLIST) : []);
    const details = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await (await get(`${api}/videos?part=snippet,contentDetails,status&id=${ids.slice(i, i + 50).join(',')}&key=${key}`)).json();
      details.push(...(r.items || []));
    }
    videos = details
      .filter((v) => v.status?.privacyStatus === 'public' && v.snippet?.liveBroadcastContent === 'none')
      .map((v) => {
        const duration = parseIsoDuration(v.contentDetails.duration);
        const kind = forceFull.has(v.id) ? 'Full episode' : forceClip.has(v.id) ? 'Clip'
          : duration <= 180 ? 'Short' : duration >= 1200 ? 'Full episode' : 'Clip';
        const t = v.snippet.thumbnails || {};
        return {
          id: v.id, kind, title: v.snippet.title, date: day(v.snippet.publishedAt), duration,
          url: kind === 'Short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
          thumb: (t.maxres || t.standard || t.high || t.medium || t.default || {}).url || null,
          summary: (v.snippet.description || '').split('\n').find((l) => l.trim().length > 40) || '',
        };
      });
    let hits = 0;
    for (const v of videos.filter((x) => x.kind === 'Full episode')) {
      const ep = match(v, episodes, { maxDays: 4 });
      if (ep && !ep.youtubeId) { ep.youtubeId = v.id; ep.youtube = v.url; hits++; } else if (!ep) report.unmatched.youtube.push(v.title);
    }
    report.sources.youtube = { ok: true, videos: videos.length, fullEpisodesMatched: hits };
  } catch (e) { report.sources.youtube = { ok: false, error: String(e.message || e) }; log('youtube failed, keeping previous videos:', e.message); }
} else if (site.podcast.youtubeChannelId) {
  // No API key: the public channel feed gives the latest 15 uploads (no durations).
  try {
    const xml = await (await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${site.podcast.youtubeChannelId}`)).text();
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(xml);
    let entries = doc?.feed?.entry || []; if (!Array.isArray(entries)) entries = [entries];
    const fresh = entries.map((en) => {
      const id = en['yt:videoId'], link = en.link?.['@href'] || '';
      const short = link.includes('/shorts/');
      return {
        id, kind: short ? 'Short' : 'Clip', title: String(en.title), date: day(en.published), duration: null,
        url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        summary: String(en['media:group']?.['media:description'] || '').split('\n').find((l) => l.trim().length > 40) || '',
      };
    });
    let hits = 0;
    for (const v of fresh.filter((x) => x.kind !== 'Short')) {
      const ep = match(v, episodes, { maxDays: 1 });
      if (ep) { v.kind = 'Full episode'; if (!ep.youtubeId) { ep.youtubeId = v.id; ep.youtube = v.url; hits++; } }
    }
    const byId = new Map(videos.map((v) => [v.id, v]));
    for (const v of fresh) byId.set(v.id, { ...(byId.get(v.id) || {}), ...v, duration: byId.get(v.id)?.duration ?? null });
    videos = [...byId.values()];
    report.sources.youtube = { ok: true, mode: 'channel feed (latest 15, add YOUTUBE_API_KEY for the full catalog)', videos: videos.length, fullEpisodesMatched: hits };
  } catch (e) { report.sources.youtube = { ok: false, error: String(e.message || e) }; }
} else report.sources.youtube = { ok: false, error: 'YOUTUBE_API_KEY not set; episodes link to the channel and the Videos page shows previous data' };

// Keep links found on earlier runs if a platform is down this time.
const prevBySlug = Object.fromEntries(previous.map((p) => [p.slug, p]));
for (const ep of episodes) {
  const p = prevBySlug[ep.slug]; if (!p) continue;
  for (const k of ['youtube', 'youtubeId', 'spotify', 'apple']) if (!ep[k] && p[k]) ep[k] = p[k];
}

await writeJson('episodes.json', episodes);
await writeJson('videos.json', videos);
await writeJson('sync-report.json', report);
log('done', JSON.stringify(report.sources));
for (const [k, v] of Object.entries(report.unmatched)) if (v.length) log(`unmatched ${k}:`, v.slice(0, 10).join(' | '));
