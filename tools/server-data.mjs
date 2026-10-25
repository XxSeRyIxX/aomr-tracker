// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// Writes app/data/server.json: what the game's public servers and Steam say about the game, which needs no game
// installed. Run it when the game adds badges or achievements, and commit what it writes; players' own game folders
// carry the lists of their installed version too, so the site shows new badges before this is run again.
// Badges, challenges, achievement ids and rarity are public. With STEAM_API_KEY set (a free Steam Web API key), it
// also writes the names, texts and icons of every achievement.
//
//   node tools/server-data.mjs [path/to/app]

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const APP = process.argv[2] ?? 'app';
const API = 'https://athens-live-api.worldsedgelink.com';
const STEAM = 'https://api.steampowered.com/ISteamUserStats';
const APP_ID = '1934680';
const HEADERS = { 'User-Agent': 'AoMRTracker-data (+https://github.com/XxSeRyIxX/aomr-tracker)' };
const LANGUAGES = ['english', 'spanish', 'latam'];

async function json(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url.split('?')[0]}: HTTP ${response.status}`);
  return response.json();
}

const ok = (answer, what) => {
  if (answer?.result?.code !== 0) throw new Error(`${what}: the server answered ${JSON.stringify(answer?.result)}`);
  return answer;
};

async function serverData() {
  const [items, challenges, achievements, rarity] = await Promise.all([
    json(`${API}/community/item/getItemDefinitions?title=athens`).then(a => ok(a, 'items')),
    json(`${API}/game/Challenge/getChallenges?title=athens`),
    json(`${API}/community/achievement/getAvailableAchievements?title=athens`).then(a => ok(a, 'achievements')),
    json(`${STEAM}/GetGlobalAchievementPercentagesForApp/v2/?gameid=${APP_ID}`),
  ]);
  if (challenges?.[0] !== 0 || !Array.isArray(challenges[1]) || !Array.isArray(challenges[2])) throw new Error('challenges: unexpected answer');

  const data = {
    fetched: new Date().toISOString().slice(0, 10),
    // Badges (1003) and titles (1004), shaped like the desktop app's ItemDef.
    items: items.itemDefinitions
      .filter(d => d.categoryIDs?.some(c => c === 1003 || c === 1004))
      .map(d => ({ id: d.id, name: d.name, categories: d.categoryIDs, meta: d.metaData ?? '' })),
    groups: challenges[1],
    challenges: challenges[2],
    achievementIds: Object.fromEntries(achievements.achievementDefs.filter(a => !a.deleted).map(a => [a.id, a.name])),
    rarity: Object.fromEntries((rarity?.achievementpercentages?.achievements ?? []).map(a => [a.name, Number(a.percent)]).filter(([, p]) => Number.isFinite(p))),
  };

  const key = process.env.STEAM_API_KEY;
  if (key) {
    const steam = {};
    for (const language of LANGUAGES) {
      const schema = await json(`${STEAM}/GetSchemaForGame/v2/?key=${encodeURIComponent(key)}&appid=${APP_ID}&l=${language}`);
      for (const a of schema?.game?.availableGameStats?.achievements ?? []) {
        const entry = steam[a.name] ??= { name: {}, desc: {}, hidden: a.hidden === 1, icon: hash(a.icon), iconGray: hash(a.icongray) };
        entry.name[language] = a.displayName ?? '';
        entry.desc[language] = a.description ?? '';
      }
    }
    data.steam = steam;
  }
  return data;
}

/** Steam's icon URLs end in the file name the achievement list uses. */
const hash = url => /([0-9a-f]{40}\.(?:jpg|png))$/i.exec(url ?? '')?.[1] ?? '';

const file = join(APP, 'data', 'server.json');
try {
  const data = await serverData();
  await writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`server.json: ${data.items.filter(i => i.categories.includes(1003)).length} badges, ${Object.keys(data.achievementIds).length} achievements` +
    `${data.steam ? `, Steam texts for ${Object.keys(data.steam).length}` : ''}.`);
} catch (error) {
  console.error(`server.json left as it was: ${error.message}`);
  process.exitCode = 1;
}
