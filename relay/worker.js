// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// The website's relay, a Cloudflare Worker: the game's servers don't let websites read the public profile pages (no
// CORS), so the website reads them here. Only those pages, and only for the website (SITE in wrangler.toml) and pages
// served from the same computer, for testing.
const API = 'https://athens-live-api.worldsedgelink.com';
const PAGES = new Set([
  '/community/leaderboard/GetPersonalStat',
  '/community/item/getInventoryByProfileIDs',
  '/community/achievement/getAchievements',
]);
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    if (origin !== env.SITE && !LOCAL.test(origin)) return new Response('Only for the tracker\'s website.', { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    const { pathname, search } = new URL(request.url);
    if (request.method !== 'GET' || !PAGES.has(pathname)) return new Response('Not found.', { status: 404, headers });
    const page = await fetch(API + pathname + search, { headers: { Accept: 'application/json' } }).catch(() => null);
    if (!page) return new Response('The game\'s servers can\'t be reached.', { status: 502, headers });
    return new Response(page.body, {
      status: page.status,
      headers: { ...headers, 'Content-Type': page.headers.get('Content-Type') ?? 'application/json' },
    });
  },
};
