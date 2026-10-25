import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseKeyValues, readSchema } from '../app/files.js';
import { buildAchievements, buildBadges, completeSchema, GODS, LEGENDS } from '../app/core.js';

// What the website ships in app/: the game's texts and art (tools/export) and the servers' lists (tools/server-data.mjs).
// The website shows the game from these alone, so they must be whole.
const app = new URL('../app/', import.meta.url);
const game = JSON.parse(readFileSync(new URL('data/game.json', app), 'utf8'));
const server = JSON.parse(readFileSync(new URL('data/server.json', app), 'utf8'));
const schema = readSchema(parseKeyValues(readFileSync(new URL('data/steam-schema.vdf', app))));
const packs = Object.fromEntries(['badges', 'achievements'].map(kind => [kind, {
  pack: readFileSync(new URL(`art/${kind}.pack`, app)),
  index: JSON.parse(readFileSync(new URL(`art/${kind}.json`, app), 'utf8')),
}]));
const { index } = packs.badges;

test('nothing the site ships has a name download managers take over, even when the page only reads it', () => {
  // IDM's default file types: in Chrome it takes these over from a page's own requests, and the page never gets them.
  const grabbed = /\.(3gp|7z|aac|ace|aif|apk|arj|asf|avi|bin|bz2|exe|gz|gzip|img|iso|lzh|m4a|m4v|mkv|mov|mp3|mp4|mpa|mpe|mpeg|mpg|msi|msu|ogg|ogv|pdf|plj|pps|ppt|qt|r\d\d|ra|rar|rm|rmvb|sea|sit|sitx|tar|tif|tiff|wav|webm|wma|wmv|z|zip)$/i;
  const shipped = readdirSync(app, { recursive: true }).map(String);
  assert.deepEqual(shipped.filter(name => grabbed.test(name)), []);
});

test('the shipped data reads', () => {
  assert.match(game.build, /^\d+$/);
  assert.match(server.fetched, /^\d{4}-\d\d-\d\d/);
  assert.ok(schema.length >= 132, `Steam's achievement list has ${schema.length} achievements.`);
  assert.ok(schema.every(a => a.name.english && a.name.spanish && a.desc.english), 'Every achievement has English and Spanish texts.');
  assert.ok(server.items.filter(i => i.categories.includes(1003)).length >= 42);
  assert.ok(Object.keys(server.achievementIds).length >= 132);
});

test('the servers know no achievement the shipped list lacks, or the site shows it as a placeholder', () => {
  const full = completeSchema(schema, server);
  const missing = full.filter(a => a.placeholder).map(a => a.api);
  assert.deepEqual(missing, [], 'Run tools/export after a game update that adds achievements.');
});

test('every badge has its art, its name and its goal in both languages', () => {
  for (const lang of ['en', 'es']) {
    const badges = buildBadges({ ...server, strings: game.strings[lang] });
    const items = new Map(server.items.map(i => [i.id, JSON.parse(i.meta || '{}')]));
    for (const badge of badges) {
      assert.ok(badge.art && index.at[badge.art], `${badge.key}: art`);
      assert.ok(game.strings[lang][items.get(badge.id).NameStrID], `${badge.key}: no game name in ${lang}`);
      assert.ok(badge.objective && !/\{\d\}|STR_/.test(badge.objective), `${badge.key}: goal "${badge.objective}" in ${lang}`);
      for (const req of badge.reqs) assert.ok(req.label, `${badge.key}: every requirement of an "all gods" badge names its god`);
    }
  }
  const gods = server.challenges.map(row => row.findLast(v => typeof v === 'string' && v.startsWith('{')))
    .map(rule => (rule ? JSON.parse(rule).RequireMajorGod : null)).filter(Boolean);
  assert.ok(gods.length >= 42);
  for (const god of new Set(gods)) {
    for (const lang of ['en', 'es']) assert.ok(game.strings[lang][`STR_CIV_${god.toUpperCase()}`], `STR_CIV_${god.toUpperCase()} in ${lang}`);
  }
});

test('each art pack holds one whole PNG per name, all of one size', () => {
  for (const [kind, { pack, index: { box: [width, height], at } }] of Object.entries(packs)) {
    let end = 0;
    for (const [name, [offset, length]] of Object.entries(at)) {
      assert.match(name, /^[a-z0-9_]+$/);
      assert.equal(offset, end, `${kind}/${name} follows the previous image.`);
      end = offset + length;
      const png = pack.subarray(offset, end);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${kind}/${name}: PNG signature`);
      assert.equal(png.toString('latin1', 12, 16), 'IHDR');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], `${kind}/${name}: size`);
      assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND', `${kind}/${name}: ends whole`);
    }
    assert.equal(end, pack.length, `Nothing else in the ${kind} pack.`);
  }
});

test('the names the tracker gives to bits and parts exist in the game texts', () => {
  const parts = ['STR_CULTURE_GREEKS', 'STR_CULTURE_EGYPTIANS', 'STR_CULTURE_NORSE', 'STR_CULTURE_ATLANTEANS', 'STR_CULTURE_CHINESE',
    'STR_CULTURE_JAPANESE', 'STR_CULTURE_AZTECS', 'STR_RESOURCE_FOOD_NAME', 'STR_RESOURCE_WOOD_NAME'];
  for (const lang of ['en', 'es']) {
    for (const god of GODS) assert.ok(game.strings[lang][`STR_CIV_${god}`], `STR_CIV_${god} in ${lang}`);
    for (const [id] of LEGENDS) assert.ok(game.strings[lang][id], `${id} in ${lang}`);
    for (const id of parts) assert.ok(game.strings[lang][id], `${id} in ${lang}`);
  }
  const achievements = buildAchievements({ schema, strings: game.strings.es, textLang: 'spanish' });
  assert.ok(achievements.every(a => a.icon.startsWith('https://')), 'Every achievement has Steam\'s icon to fall back on.');
  assert.deepEqual(achievements.filter(a => !packs.achievements.index.at[a.art]).map(a => a.api), [], 'Every achievement has the game\'s picture.');
});
