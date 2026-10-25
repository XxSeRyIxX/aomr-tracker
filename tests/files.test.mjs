import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { fileKind, parseKeyValues, pickFiles, profileLinks, readGameCache, readPasted, readSchema, readStats, readUnlocks, relayLink } from '../app/files.js';
import { kv, playerFile } from './fixtures.mjs';

const schemaFile = kv({
  1934680: {
    gamename: 'Age of Mythology: Retold',
    stats: {
      1: {
        type: 'ACHIEVEMENTS',
        bits: {
          0: { name: 'ACHIEVEMENT_ANNIHILATION', bit: 0, display: {
            name: { english: 'Annihilation', spanish: 'Aniquilación', LATAM: 'Aniquilación total' },
            desc: { english: 'Defeat 10000 units in battle.', spanish: 'Derrota a 10 000 unidades en batalla.' },
            hidden: '0', icon: `${'a'.repeat(40)}.jpg`, icon_gray: `${'b'.repeat(40)}.jpg` } },
          2: { name: 'ACHIEVEMENT_SECRET', display: { name: { english: 'Secret' }, desc: { english: 'Do the secret thing.' }, hidden: 1, icon: 'c.jpg', icon_gray: 'd.jpg' } },
        },
      },
      2: { type: 'ACHIEVEMENTS', bits: { 31: { name: 'ACHIEVEMENT_LAST', display: { name: { english: 'Last' }, desc: { english: 'x' } } } } },
    },
  },
});

test('Steam KeyValues: sections, texts and numbers, and no way to reach Object.prototype', () => {
  const root = parseKeyValues(kv({ a: { b: 'x', c: -3, ['__proto__']: { polluted: 'yes' } } }));
  assert.equal(root.a.b, 'x');
  assert.equal(root.a.c, -3);
  assert.equal(Object.getPrototypeOf(root.a), null);
  assert.equal(({}).polluted, undefined);
  assert.throws(() => parseKeyValues(new Uint8Array([0, 120, 0, 1, 121]).buffer), /never ends/);
  assert.throws(() => parseKeyValues(new Uint8Array([2, 120, 0, 1, 2]).buffer), /ends early/);
  assert.throws(() => parseKeyValues(new Uint8Array([9, 120, 0]).buffer), /Unknown KeyValues type 9/);
});

test('the achievement list keeps every language and the game order', () => {
  const schema = readSchema(parseKeyValues(schemaFile));
  assert.deepEqual(schema.map(a => [a.api, a.block, a.bit]), [['ACHIEVEMENT_ANNIHILATION', 1, 0], ['ACHIEVEMENT_SECRET', 1, 2], ['ACHIEVEMENT_LAST', 2, 31]]);
  assert.equal(schema[0].name.spanish, 'Aniquilación');
  assert.equal(schema[0].name.latam, 'Aniquilación total', 'Language keys are lower case.');
  assert.equal(schema[0].desc.english, 'Defeat 10000 units in battle.');
  assert.equal(schema[1].hidden, true, 'Hidden can be a number or a text.');
  assert.equal(schema[0].hidden, false);
  assert.throws(() => readSchema(parseKeyValues(kv({ 440: { stats: {} } }))), /Not the achievement list/);
});

test('unlocks: one bit per achievement, with the time Steam kept', () => {
  const schema = readSchema(parseKeyValues(schemaFile));
  const user = parseKeyValues(kv({ cache: { crc: 1, 1: { data: 4, AchievementTimes: { 2: 1700000000 } }, 2: { data: -2147483648 } } }));
  const unlocks = readUnlocks(user, schema);
  assert.deepEqual([...unlocks], [['ACHIEVEMENT_SECRET', 1700000000], ['ACHIEVEMENT_LAST', 0]], 'Bit 31 works with the sign bit; no time means 0.');
  assert.throws(() => readUnlocks(parseKeyValues(kv({ other: {} })), schema), /Not a Steam achievement file/);
});

test('lcs.dat: AES after random filler, with or without it', async () => {
  const utf16 = s => {
    const bytes = new Uint8Array(4 + s.length * 2);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, s.length, true);
    for (let i = 0; i < s.length; i++) view.setUint16(4 + i * 2, s.charCodeAt(i), true);
    return bytes;
  };
  const number = (n, bigint) => {
    const bytes = new Uint8Array(bigint ? 8 : 4);
    const view = new DataView(bytes.buffer);
    if (bigint) view.setBigInt64(0, BigInt(n), true);
    else view.setInt32(0, n, true);
    return bytes;
  };
  const plain = new Uint8Array([...number(3), ...utf16('76561197989676140'), ...number(2),
    ...utf16('STAT_ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS'), ...number(0x42414, true),
    ...utf16('STAT_GAUNTLET_REWARD_XP'), ...number(2 ** 40, true)]);
  const hex = s => Uint8Array.from(s.match(/../g), b => parseInt(b, 16));
  const key = await crypto.subtle.importKey('raw', hex('340730320C4D6A060101010205070901315A084C4D51573132584C4159434446'), 'AES-CBC', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: hex('4F5431534631590F4D6A203508706802') }, key, plain));
  const withFiller = new Uint8Array([...number(-131), ...crypto.getRandomValues(new Uint8Array(130)), ...cipher]);

  for (const file of [withFiller, cipher]) {
    const stats = await readStats(file.buffer);
    assert.equal(stats.playerId, '76561197989676140');
    assert.equal(stats.values.STAT_ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS, 0x42414);
    assert.equal(stats.values.STAT_GAUNTLET_REWARD_XP, 2 ** 40);
  }
  await assert.rejects(readStats(new Uint8Array(10).buffer), /too short/);
  await assert.rejects(readStats(new Uint8Array(64).buffer));
});

test('files are told apart by name', () => {
  assert.equal(fileKind('lcs.dat'), 'stats');
  assert.equal(fileKind('LCS.DAT'), 'stats');
  assert.equal(fileKind('UserGameStats_29410412_1934680.bin'), 'steamUser');
  assert.equal(fileKind('UserGameStatsSchema_1934680.bin'), 'steamSchema');
  assert.equal(fileKind('UserGameStats_29410412_440.bin'), null, 'Other games\' files are refused.');
  assert.equal(fileKind('cmp.dat'), null);
  assert.equal(fileKind('76561197989676140item-athens-andromeda-live-release21.dat'), 'cache');
  assert.equal(fileKind('2535412345678901item-athens-andromeda-live-release22.dat'), 'cache', 'Players of other platforms have other ids.');
  assert.equal(fileKind('ItemCategoryCache-athens-andromeda-live-release21.dat'), 'items');
  assert.equal(fileKind('ChallengeGetChallengesCache-athens-andromeda-live-release21.dat'), 'challenges');
  assert.equal(fileKind('GetAvailableAchievementsCache-athens-andromeda-live-release21.dat'), 'achievementIds');
  assert.equal(fileKind('PresenceDataCache-athens-andromeda-live-release21.dat'), null);
  assert.equal(fileKind('live.dat'), null);
});

test('from a whole folder, the newest build and the newest file of each kind', () => {
  const file = (name, lastModified) => ({ name, lastModified });
  const picked = pickFiles([
    file('76561197989676140item-athens-andromeda-live-release9.dat', 900),
    file('76561197989676140item-athens-andromeda-live-release21.dat', 100),
    file('76561197989676140item-athens-andromeda-live-release20.dat', 800),
    file('ItemCategoryCache-athens-andromeda-live-release21.dat', 1),
    file('lcs.dat', 5), file('lcs.dat', 7), file('lcs.dat', 6),
    file('Grabar partida0.mythrec', 1000), file('UserProfile.xml', 1000),
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(picked).map(([kind, f]) => [kind, [f.name, f.lastModified]])), {
    cache: ['76561197989676140item-athens-andromeda-live-release21.dat', 100],
    items: ['ItemCategoryCache-athens-andromeda-live-release21.dat', 1],
    stats: ['lcs.dat', 7],
  }, 'Release 21 beats release 9 and 20, however old the files.');
  assert.deepEqual(pickFiles([]), {});
});

/** A cache list as the game writes it: version, size, zlib JSON, zero padding. */
const cacheList = (version, value, padding = 64) => {
  const json = Buffer.from(JSON.stringify(value));
  const packed = deflateSync(json);
  const head = Buffer.alloc(8);
  head.writeInt32LE(version, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, packed, Buffer.alloc(padding)]);
};

test('the game\'s cache: the player\'s achievements, items and badge progress', async () => {
  const player = {
    platformAccountID: '76561197989676140',
    profileID: 1077381382,
    'm_loginEvent.m_info': { defaultProfileInfo: { id: 1077381382, name: '/steam/76561197989676140', alias: 'XxSeRyIxX' } },
    'm_GetInventoryItemsEvent.m_info.itemInstances': [
      { id: 1, 'itemDefinition.id': 10000, creationDate: 1777118765 },
      { id: 2, 'itemDefinition.id': 10000, creationDate: 1777000000 },
      { id: 3, 'itemDefinition.id': 1004, creationDate: -1 },
    ],
    'm_challengeProgressEvent.m_info': { result: -1, challengeProgresses: [
      { progressID: 9, 'definition.definitionID': 10096, status: 1, progress: 0, expiryTime: -1, lastCompletedTime: 1785107883, assignedTime: 1 },
      { progressID: 10, 'definition.definitionID': 10118, status: 0, progress: 3, expiryTime: -1, lastCompletedTime: -1, assignedTime: 1 },
    ] },
    'm_achievementsEvent.m_info': { userAchievementsMap: [
      { profileID: 1077381382, grantedAchievements: [{ 'achievement.id': 54, achievedDate: 1776381346 }] },
      { profileID: 5, grantedAchievements: [{ 'achievement.id': 7, achievedDate: 1 }] },
    ] },
  };
  assert.deepEqual(await readGameCache(playerFile(player)), {
    kind: 'cache', profileId: 1077381382, playerId: '76561197989676140', alias: 'XxSeRyIxX', platform: 'Steam',
    unlocked: { 54: 1776381346 },
    earned: { 10000: 1777000000, 1004: 0 },
    progress: [{ id: 10096, done: true, count: 0, at: 1785107883 }, { id: 10118, done: false, count: 3, at: null }],
  }, 'Another profile\'s achievements are left out; an item without a date still counts.');
});

test('the game\'s cache: the lists of badges, challenges and achievements of the installed version', async () => {
  const items = await readGameCache(cacheList(4, { result: 0, itemCategories: [], itemDefinitions: [
    { id: 10000, name: 'BadgeTheSwift', metaData: '{"Tier":1}', categoryIDs: [1003] },
    { id: 1004, name: 'TitleTheSwift', metaData: '', categoryIDs: [1004] },
    { id: 5, name: 'Avatar', metaData: '', categoryIDs: [1001] },
  ] }));
  assert.deepEqual(items, { kind: 'items', items: [
    { id: 10000, name: 'BadgeTheSwift', categories: [1003], meta: '{"Tier":1}' },
    { id: 1004, name: 'TitleTheSwift', categories: [1004], meta: '' },
  ] });

  const groups = [[1000, 'Persistent_TheSwift', 'x', 2, null, null, -1, '{}']];
  const challenges = [[10000, 1000, 'BadgeChallenge_TheSwift', 'tracker', null, null, null, 1, '', -1, -1, -1, 0]];
  assert.deepEqual(await readGameCache(cacheList(1, [0, groups, challenges, 'signature'])), { kind: 'challenges', groups, challenges });

  const ids = await readGameCache(cacheList(0, [0, [[4, 'ACHIEVEMENT_ANNIHILATION', null, null, '', 1, 0, -1], [5, '<b>x</b>'], ['x', 'ACHIEVEMENT_X']], 'signature']));
  assert.deepEqual(ids, { kind: 'achievementIds', achievementIds: { 4: 'ACHIEVEMENT_ANNIHILATION' } });

  // A checksum that ends in zero bytes looks like padding; the decoder puts them back.
  const zeros = cacheList(0, [0, [[99, 'ACHIEVEMENT_ZERO_99']]], 16);
  assert.equal(zeros[zeros.length - 17], 0, 'This list ends its checksum with a zero byte.');
  assert.deepEqual((await readGameCache(zeros)).achievementIds, { 99: 'ACHIEVEMENT_ZERO_99' });
});

test('cache files the tracker doesn\'t read, or damaged ones, are refused', async () => {
  await assert.rejects(readGameCache(new Uint8Array(4)), /Not one of the game's cache files/);
  await assert.rejects(readGameCache(cacheList(2, { offlineTelemetryInfos: [] })), /Not one of the game's cache files the tracker reads/);
  await assert.rejects(readGameCache(cacheList(1, [3, [], []])), /error from the game servers/);
  const broken = cacheList(4, { itemDefinitions: [] });
  broken.fill(0x41, 12, 20);
  await assert.rejects(readGameCache(broken));
  const cut = playerFile({ profileID: 1, 'm_challengeProgressEvent.m_info': {} });
  await assert.rejects(readGameCache(cut.subarray(0, cut.length - 30)));
});

// Shaped like the game servers' public pages (trimmed).
const OK = '"result":{"code":0, "message":"SUCCESS"}';
const findPage = `{${OK},"statGroups":[{"id":3658274,"name":"","type":1,"members":[{"profile_id":1077381382,"name":"/steam/76561197989676140","alias":"XxSeRyIxX","xp":0,"level":1}]},`
  + `{"id":1,"members":[{"profile_id":5,"name":"/xboxlive/2533274800000000","alias":"Console"},{"profile_id":6,"name":"/psn/123","alias":"Pad"}]}],"leaderboardStats":[]}`;
const item = (definition, at) => ({ id: definition * 7, itemdefinition_id: definition, profile_id: 1077381382, creationdate: at, metadata: '' });
const badgesPage = JSON.stringify({ result: { code: 0, message: 'SUCCESS' },
  itemInstancesByProfileID: [{ '"1077381382"': [item(10000, 1777118765), item(10001, 1777118765), item(10000, 1777000000), item(10072, null)] }] });
const achievementsPage = `{${OK},"userAchievementsMap":[{"1077381382":[{"achievement_id":54,"achieveddate":1776381346},{"achievement_id":22,"achieveddate":1776381499}]}]}`;

test('pasted profile pages: players, earned badges and achievements', () => {
  assert.deepEqual(readPasted(findPage), { kind: 'profiles', players: [
    { id: 1077381382, alias: 'XxSeRyIxX', platform: 'Steam' }, { id: 5, alias: 'Console', platform: 'Xbox' }, { id: 6, alias: 'Pad', platform: 'PlayStation' }] });
  assert.deepEqual(readPasted(badgesPage), { kind: 'badges', id: 1077381382, earned: { 10000: 1777000000, 10001: 1777118765, 10072: 0 } },
    'The earliest copy of an item dates it; a missing date still counts as earned.');
  assert.deepEqual(readPasted(achievementsPage), { kind: 'achievements', id: 1077381382, unlocked: { 54: 1776381346, 22: 1776381499 } });
});

test('what browsers add around a copied page is dropped', () => {
  const pretty = JSON.stringify(JSON.parse(achievementsPage), null, 2);
  assert.equal(readPasted(`Pretty-print \u2610\r\n${pretty}\r\n`).kind, 'achievements');
  assert.equal(readPasted(`  ${badgesPage}  `).id, 1077381382);
});

test('pastes that aren\'t profile pages are refused', () => {
  assert.throws(() => readPasted(''), /No game data/);
  assert.throws(() => readPasted('hello'), /No game data/);
  assert.throws(() => readPasted('{ broken'), /No game data/);
  assert.throws(() => readPasted('{"a": }'), SyntaxError);
  assert.throws(() => readPasted('{"result":{"code":9, "message":"UNKNOWN_ALIASES"}}'), { code: 'server', message: /UNKNOWN_ALIASES/ },
    'An unknown name (they are case-sensitive) is an answer from the servers, not a bad paste.');
  assert.throws(() => readPasted(`{${OK},"items":[]}`), /isn't one of the profile pages/);
  assert.deepEqual(readPasted(`{${OK},"statGroups":[]}`), { kind: 'profiles', players: [] }, 'A name nobody has finds no players.');
  assert.deepEqual(readPasted(`{${OK},"itemInstancesByProfileID":[]}`), { kind: 'badges', id: null, earned: {} });
});

test('profile page links', () => {
  const find = new URL(profileLinks.find('XxSeRyIxX'));
  assert.equal(find.origin, 'https://athens-live-api.worldsedgelink.com');
  assert.equal(find.searchParams.get('aliases'), '["XxSeRyIxX"]');
  assert.equal(new URL(profileLinks.find('76561197989676140')).searchParams.get('profile_names'), '["/steam/76561197989676140"]',
    'A Steam ID finds the Steam account itself.');
  assert.equal(new URL(profileLinks.find('A "quoted" & odd name')).searchParams.get('aliases'), '["A \\"quoted\\" & odd name"]');
  assert.equal(new URL(profileLinks.badges(1077381382)).searchParams.get('profileIDs'), '[1077381382]');
  assert.equal(new URL(profileLinks.achievements(1077381382)).pathname, '/community/achievement/getAchievements');
});

test('the relay serves the same page at its own address', () => {
  const page = new URL(profileLinks.find('A "quoted" & odd name'));
  const relayed = new URL(relayLink(page.href, 'https://aomr-tracker-relay.example.workers.dev'));
  assert.equal(relayed.origin, 'https://aomr-tracker-relay.example.workers.dev');
  assert.equal(relayed.pathname + relayed.search, page.pathname + page.search);
});
