# Iconic Sonics website

Astro static site, hosted on Vercel. Episodes and videos load automatically from the podcast feed, Apple, Spotify and YouTube every time the site builds.

## Run it locally

```
npm install
npm run dev        # http://localhost:4321
npm run build      # runs the feed sync, then builds to dist/
```

## Where things live

| What | File |
| --- | --- |
| Event bar, featured episode, social links, Web3Forms key, partner email | `src/data/site.json` |
| Guests (name, role, photo, category, `featured` for the homepage) | `src/data/guests.json` |
| Partners (logo, story, website) | `src/data/partners.json` |
| Per-episode extras: square thumbnail, guests, topics, era | `src/data/episode-overrides.json` (keyed by slug or `#12`) |
| Episodes and videos from the feeds (written by the sync, do not edit) | `src/data/generated/` |
| What the last sync matched and missed | `src/data/generated/sync-report.json` |
| Page templates | `src/pages/` |
| Shared header, footer, menu, SEO | `src/layouts/Base.astro` |

Set `featuredEpisode` in `site.json` to an episode slug to pin it in the hero; leave it `null` to always feature the newest episode. Set `showPlaceholders` to `false` before launch to hide any section that has no real content yet.

## Vercel settings

Environment variables (Project > Settings > Environment Variables):

- `YOUTUBE_API_KEY` turns on the Videos page and per-episode YouTube links.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` turn on per-episode Spotify links.
- `YT_FULL_PLAYLIST`, `YT_CLIPS_PLAYLIST` (optional) force videos in those playlists to count as full episodes or clips.

Without them the site still builds; links fall back to the show or channel page.

## Automatic updates

`.github/workflows/rebuild.yml` triggers a Vercel rebuild every 3 hours. Create a Deploy Hook in Vercel (Settings > Git > Deploy Hooks), then save its URL as the GitHub Actions secret `VERCEL_DEPLOY_HOOK`.
