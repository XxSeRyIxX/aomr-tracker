import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kv, playerFile } from './fixtures.mjs';

// sources.js keeps what it read in the browser's storage; here, in memory.
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const { addFiles, applyCopy, data, forget, makeCopy, readCopy } = await import('../app/sources.js');

const cache = playerFile({
  platformAccountID: '76561197989676140',
  profileID: 1077381382,
  'm_loginEvent.m_info': { defaultProfileInfo: { id: 1077381382, name: '/steam/76561197989676140', alias: 'XxSeRyIxX' } },
  'm_GetInventoryItemsEvent.m_info.itemInstances': [{ id: 1, 'itemDefinition.id': 10000, creationDate: 1777118765 }],
  'm_challengeProgressEvent.m_info': { result: -1, challengeProgresses: [
    { progressID: 10, 'definition.definitionID': 10118, status: 0, progress: 3, expiryTime: -1, lastCompletedTime: -1, assignedTime: 1 },
  ] },
  'm_achievementsEvent.m_info': { userAchievementsMap: [{ profileID: 1077381382, grantedAchievements: [{ 'achievement.id': 54, achievedDate: 1776381346 }] }] },
});
const steamUser = kv({ cache: { crc: 1, 1: { data: 4, AchievementTimes: { 2: 1700000000 } } } });
const marks = { achievements: ['ACHIEVEMENT_GOD_TIER'], checks: ['ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS:ZEUS'], badges: [10002], reqs: [10120] };

test('a copy carries the player\'s files, public profile and marks to another browser', async () => {
  await addFiles([
    new File([cache], '76561197989676140item-athens-andromeda-live-release21.dat', { lastModified: 1761400000000 }),
    new File([steamUser], 'UserGameStats_29410412_1934680.bin', { lastModified: 1761300000000 }),
  ]);
  data.profile = { id: 1077381382, alias: 'XxSeRyIxX', platform: 'Xbox', unlocked: { 22: 1776000000 }, achievementsAt: 1761000000000 };
  const before = { cache: data.files.cache, steamUser: data.files.steamUser };

  const saved = JSON.stringify(await makeCopy(marks));
  assert.ok(saved.length < 10_000, 'Small enough to send anywhere.');
  forget();
  assert.equal(data.files.cache, null);

  const copy = await readCopy(saved);
  applyCopy(copy);
  assert.deepEqual({ cache: data.files.cache, steamUser: data.files.steamUser }, before, 'The files read the same as before.');
  assert.deepEqual(data.profile, { id: 1077381382, alias: 'XxSeRyIxX', platform: 'Xbox', unlocked: { 22: 1776000000 }, achievementsAt: 1761000000000 });
  assert.deepEqual(copy.marks, marks);
  assert.equal(data.files.stats, null, 'A file the copy doesn\'t have isn\'t there after it either.');
  assert.ok(JSON.parse(storage.get('aomr-tracker-files')).cache.data, 'The browser keeps the copy\'s files for the next visit.');

  // The desktop reads the game's files itself: a copy only gives it the profile.
  forget();
  applyCopy(copy, { files: false });
  assert.equal(data.files.cache, null);
  assert.equal(data.profile.alias, 'XxSeRyIxX');
});

test('a copy keeps only what the tracker can use, and anything else is refused', async () => {
  const copy = await readCopy(JSON.stringify({
    app: 'aomr-tracker', version: 1, saved: '2026-10-25T10:00:00.000Z', files: {},
    profile: { id: 5, alias: 'x'.repeat(500), earned: { 10000: 1, __proto__: 2, 'not a number': 3, 10002: -1 } },
    marks: { achievements: ['ACHIEVEMENT_A', 'achievement_lower', '<img>', 7], checks: ['ACHIEVEMENT_A:ZEUS', 'ACHIEVEMENT_A:a b'], badges: [1, '2', -3, 1.5], reqs: [4, 4] },
  }));
  assert.equal(copy.saved, Date.parse('2026-10-25T10:00:00.000Z'));
  assert.equal(copy.profile.alias.length, 100);
  assert.deepEqual(copy.profile.earned, { 10000: 1 });
  assert.equal(Object.getPrototypeOf(copy.profile.earned), Object.prototype);
  assert.deepEqual(copy.marks, { achievements: ['ACHIEVEMENT_A'], checks: ['ACHIEVEMENT_A:ZEUS'], badges: [1], reqs: [4] });
  assert.deepEqual((await readCopy('{"app":"aomr-tracker","version":1,"profile":{"id":"5"}}')).profile, {}, 'A profile id must be a number.');

  for (const text of ['not json', '{}', '{"app":"other","version":1}', '{"app":"aomr-tracker","version":2}',
    '{"app":"aomr-tracker","version":1,"files":{"cache":{"data":"not base64!"}}}',
    `{"app":"aomr-tracker","version":1,"files":{"cache":{"data":"${Buffer.from(steamUser).toString('base64')}"}}}`]) {
    await assert.rejects(readCopy(text), undefined, text.slice(0, 60));
  }
  await assert.rejects(readCopy(' '.repeat(4 * 1024 * 1024 + 1)), /Too big/);
});
