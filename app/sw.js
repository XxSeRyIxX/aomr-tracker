// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// The website's offline copy: network first, the cache only when the network fails. There is no build step to hash
// file names, so a cache-first worker would keep visitors on their first version forever. The desktop app doesn't
// use this worker.
// A new name whenever shipped files are renamed or removed, so visitors' old copies are deleted.
const CACHE = 'aomr-tracker-2';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'core.js',
  'files.js',
  'i18n.js',
  'native.js',
  'sources.js',
  'icon.png',
  'manifest.webmanifest',
  'data/game.json',
  'data/server.json',
  'data/steam-schema.vdf',
];
// The art (art/achievements.pack, art/badges.pack) is cached the first time it shows, rather than on install.

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  // Only this site's own caches: all github.io sites of one account share the browser's storage.
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(name => name.startsWith('aomr-tracker') && name !== CACHE).map(name => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(async response => {
        if (!response.ok) return (await caches.match(request)) || response;
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
        return response;
      })
      .catch(() => caches.match(request).then(hit =>
        hit || (request.mode === 'navigate' ? caches.match('index.html') : Promise.reject(new Error('offline'))))),
  );
});
