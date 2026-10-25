import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAchievements, buildBadges, categoryOf, closest, completeSchema, format, goalOf, matches, mergeDefinitions, mergeEarned, mergeUnlocks, setBits, steamTextLanguage, summary, unlocksByName, viewAchievements, viewBadges } from '../app/core.js';

const strings = {
  STR_CIV_ZEUS: 'Zeus', STR_CIV_HADES: 'Hades', STR_CIV_POSEIDON: 'Poseidón', STR_CIV_RA: 'Ra', STR_CIV_KRONOS: 'Cronos',
  STR_CHARACTER_KASTOR: 'Cástor',
  STR_CULTURE_GREEKS: 'Griegos', STR_CULTURE_NORSE: 'Nórdicos',
  STR_SW_HARD: 'Difícil', STR_SW_LEGENDARY: 'Legendaria',
  STR_INGAME_HELP_HISTORY_TITLE_GREEK: 'Griego',
  STR_BDGTTL_OBJECTIVE_01: 'Gana un nodo de Desafío en {0} minutos.',
  STR_BDGTTL_OBJECTIVE_05: 'Completa {0} nodos sin perder una vida.',
  STR_BDGTTL_OBJECTIVE_10: 'Completa {0} recorridos en {1} o superior sin perder una vida.',
  STR_BDGTTL_OBJECTIVE_11: 'Derrota a un jefe del Laberinto en cualquier dificultad.',
  STR_BDGTTL_OBJECTIVE_132: 'Derrota a un jefe del Laberinto con cada dios mayor {0}.',
  STR_BDGTTL_TITLE_NAME_01: 'Veloz',
  STR_BDGTTL_TITLE_NAME_59: 'Conquistador del Olimpo',
};

let bit = 0;
const ach = (api, en, extra = {}) => ({
  api, block: 1, bit: bit++, name: { english: api, spanish: `${api} (es)` }, desc: { english: en, spanish: `${en} (es)` },
  hidden: false, icon: `${'a'.repeat(40)}.jpg`, iconGray: `${'b'.repeat(40)}.jpg`, ...extra,
});
const sets = (achievements = [], badges = [], reqs = [], checks = []) =>
  ({ achievements: new Set(achievements), badges: new Set(badges), reqs: new Set(reqs), checks: new Set(checks) });

test('goals come from the first number of the English text', () => {
  assert.equal(goalOf('Defeat 10000 units in battle.'), 10000);
  assert.equal(goalOf('Acquire 1,000 food and 1,000 wood using Pixius.'), 1000);
  assert.equal(goalOf('Complete a Wonder.'), null);
  assert.equal(goalOf('Reach bushido tier 5.'), 5);
  assert.equal(goalOf('Play 1 match.'), null, 'A goal of one is just done or not.');
});

test('bits, texts and languages', () => {
  assert.deepEqual(setBits(0x42414), [2, 4, 10, 13, 18]);
  assert.deepEqual(setBits(0xa81), [0, 7, 9, 11]);
  assert.deepEqual(setBits(2 ** 40 + 1), [0, 40], 'Values above 32 bits still work.');
  assert.deepEqual(setBits(undefined), []);
  assert.equal(format('Win in {0} minutes as {1}.', ['8', 'Greeks']), 'Win in 8 minutes as Greeks.');
  assert.equal(format('Keep {2}', ['a']), 'Keep {2}', 'Missing values stay visible.');
  assert.equal(steamTextLanguage('es', 'latam'), 'latam');
  assert.equal(steamTextLanguage('es', undefined), 'spanish');
  assert.equal(steamTextLanguage('en', 'spanish'), 'english');
});

test('achievement categories', () => {
  assert.equal(categoryOf('ACHIEVEMENT_AOTG_SLAYER', 'Allow your Legend to deal the final blow on 50 enemies.'), 'arena');
  assert.equal(categoryOf('ACHIEVEMENT_GOD_TIER', 'Reach level 99 in the Gauntlet game mode.'), 'gauntlet');
  assert.equal(categoryOf('ACHIEVEMENT_ALL_DOLLED_UP', 'Equip a badge on your player profile.'), 'gauntlet');
  assert.equal(categoryOf('ACHIEVEMENT_ARKANTOS_ASCENDED', 'Complete the Fall of the Trident campaign.'), 'story');
  assert.equal(categoryOf('ACHIEVEMENT_HADES_RUIN', "Destroy Hades' Town Centers in 'Hells Divided' on Hard or higher difficulty."), 'story');
  assert.equal(categoryOf('ACHIEVEMENT_ANNIHILATION', 'Defeat 10000 units in battle.'), 'matches');
});

test('counters, god and legend checklists and parts come from the game statistics', () => {
  const schema = [
    ach('ACHIEVEMENT_ANNIHILATION', 'Defeat 10000 units in battle.'),
    ach('ACHIEVEMENT_DREAMWEAVER', 'Cause 104 enemy units to sleep.'),
    ach('ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS', 'Win the final Boss node in the Gauntlet game mode with 9 different Major Gods.'),
    ach('ACHIEVEMENT_A_LEGENDARY_RUSH', 'Win a final Boss node in the Gauntlet game mode with 5 different Legends.'),
    ach('ACHIEVEMENT_TITANIC_TERROR', 'Unleash a Greek, an Egyptian, a Norse, and an Atlantean Titan.'),
    ach('ACHIEVEMENT_WE_HAVE_TITANS_AT_HOME', 'Summon a Titan from 6 different Pantheons using the Favor Stash.'),
    ach('ACHIEVEMENT_CREATING_A_MASTERPIECE', 'Complete a Wonder.', { hidden: true }),
    ach('ACHIEVEMENT_FUTURE_PARTS', 'Do it with every culture.'),
  ];
  const stats = {
    STAT_ACHIEVEMENT_ANNIHILATION: 2500,
    STAT_ACHIEVEMENT_DREAMWEAVER: 106,
    STAT_ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS: 0x42414 + 2 ** 24,
    STAT_ACHIEVEMENT_A_LEGENDARY_RUSH: 0xa81,
    STAT_ACHIEVEMENT_TITANIC_TERROR_GREEK: 1,
    STAT_ACHIEVEMENT_TITANIC_TERROR_NORSE: 3,
    STAT_ACHIEVEMENT_FUTURE_PARTS_AZTEC: 1,
    STAT_ACHIEVEMENT_FUTURE_PARTS_MOON: 0,
  };
  const unlocks = new Map([['ACHIEVEMENT_DREAMWEAVER', 1779000000]]);
  const [annihilation, dream, gods, legends, titans, home, wonder, future] =
    buildAchievements({ schema, textLang: 'spanish', unlocks, stats, strings, rarity: { ACHIEVEMENT_ANNIHILATION: 12.5 } });

  assert.equal(annihilation.name, 'ACHIEVEMENT_ANNIHILATION (es)', 'Texts come in the chosen language.');
  assert.deepEqual(annihilation.progress, { value: 2500, goal: 10000 });
  assert.equal(annihilation.ratio, 0.25);
  assert.equal(annihilation.rarity, 12.5);
  assert.equal(annihilation.known, true);
  assert.match(annihilation.icon, /^https:\/\/cdn\.fastly\.steamstatic\.com\/.+bbbb/, 'Locked achievements show the gray icon.');
  assert.equal(annihilation.art, 'achievement_annihilation', 'The game\'s picture is named after the achievement.');

  assert.equal(dream.unlocked, true);
  assert.equal(dream.unlockedAt, 1779000000);
  assert.deepEqual(dream.progress, { value: 104, goal: 104 }, 'Counters past the goal stop at the goal.');
  assert.match(dream.icon, /aaaa/);

  assert.deepEqual(gods.progress, { value: 6, goal: 9 });
  assert.equal(gods.checklist.length, 24, 'The 23 gods the tracker knows, plus one it doesn\'t.');
  assert.deepEqual(gods.checklist.filter(c => c.done).map(c => c.label), ['Hades', 'Ra', 'Cronos', 'Freyr', 'Tsukuyomi', '#24'],
    'Bit n is civilization n, named by the game in its language; a god newer than the tracker still counts.');

  assert.deepEqual(legends.progress, { value: 4, goal: 5 });
  assert.deepEqual(legends.checklist.filter(c => c.done).map(c => c.label), ['Cástor', 'Reginleif', 'Halogi', 'Chiyou']);

  assert.deepEqual(titans.checklist.map(c => [c.label, c.done]), [['Griegos', true], ['Egyptians', false], ['Nórdicos', true], ['Atlanteans', false]]);
  assert.deepEqual(titans.progress, { value: 2, goal: 4 });

  assert.deepEqual(home.progress, { value: 0, goal: 6 }, 'A statistic the game never wrote counts as zero.');
  assert.equal(wonder.progress, null);
  assert.equal(wonder.hidden, true);
  assert.deepEqual(future.checklist.map(c => [c.label, c.done]), [['Aztecs', true], ['Moon', false]],
    'Parts the tracker doesn\'t know show from the statistics themselves.');
});

test('marks count for whatever the data doesn\'t show as done', () => {
  const schema = [ach('ACHIEVEMENT_A', 'a'), ach('ACHIEVEMENT_B', 'b')];
  const [a, b] = buildAchievements({ schema, marks: sets(['ACHIEVEMENT_B']) });
  assert.deepEqual([a.known, a.unlocked, a.manual, a.source], [false, false, false, null]);
  assert.deepEqual([b.known, b.unlocked, b.manual, b.unlockedAt, b.source], [false, true, true, null, 'mark']);
  const [, other] = buildAchievements({ schema, unlocks: new Map(), marks: sets(['ACHIEVEMENT_B']) });
  assert.deepEqual([other.unlocked, other.manual], [true, true], 'Data without it (another platform\'s player) keeps the mark.');
  const [, both] = buildAchievements({ schema, unlocks: new Map([['ACHIEVEMENT_B', 5]]), marks: sets(['ACHIEVEMENT_B']) });
  assert.deepEqual([both.unlocked, both.manual, both.source, both.unlockedAt], [true, false, 'data', 5], 'Data wins over a mark.');
});

test('without unlock data, a counter at its goal means unlocked', () => {
  const schema = [
    ach('ACHIEVEMENT_ANNIHILATION', 'Defeat 10000 units in battle.'),
    ach('ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS', 'Win the final Boss node in the Gauntlet game mode with 9 different Major Gods.'),
    ach('ACHIEVEMENT_TITANIC_TERROR', 'Unleash a Greek, an Egyptian, a Norse, and an Atlantean Titan.'),
    ach('ACHIEVEMENT_CREATING_A_MASTERPIECE', 'Complete a Wonder.'),
    ach('ACHIEVEMENT_DREAMWEAVER', 'Cause 104 enemy units to sleep.'),
  ];
  const stats = {
    STAT_ACHIEVEMENT_ANNIHILATION: 12000,
    STAT_ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS: 0b1111111110,
    STAT_ACHIEVEMENT_TITANIC_TERROR_GREEK: 1, STAT_ACHIEVEMENT_TITANIC_TERROR_EGYPTIAN: 1,
    STAT_ACHIEVEMENT_TITANIC_TERROR_NORSE: 2, STAT_ACHIEVEMENT_TITANIC_TERROR_ATLANTEAN: 1,
    STAT_ACHIEVEMENT_DREAMWEAVER: 50,
  };
  const [units, gods, titans, wonder, dream] = buildAchievements({ schema, stats });
  assert.deepEqual([units.unlocked, units.source, units.manual, units.unlockedAt], [true, 'stats', false, null]);
  assert.deepEqual(units.progress, { value: 10000, goal: 10000 });
  assert.equal(gods.source, 'stats', 'Nine gods set.');
  assert.equal(titans.source, 'stats', 'All four parts set.');
  assert.deepEqual([wonder.unlocked, dream.unlocked], [false, false]);
  const [withData] = buildAchievements({ schema, stats, unlocks: new Map() });
  assert.deepEqual([withData.unlocked, withData.source], [false, null], 'Unlock data, when there is some, is what counts.');
});

test('checklist entries can be ticked by hand', () => {
  const schema = [
    ach('ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS', 'Win the final Boss node in the Gauntlet game mode with 9 different Major Gods.'),
    ach('ACHIEVEMENT_WE_HAVE_TITANS_AT_HOME', 'Summon a Titan from 6 different Pantheons using the Favor Stash.'),
    ach('ACHIEVEMENT_TITANIC_TERROR', 'Unleash a Greek, an Egyptian, a Norse, and an Atlantean Titan.'),
  ];
  const stats = { STAT_ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS: 0b110, STAT_ACHIEVEMENT_WE_HAVE_TITANS_AT_HOME: 0b11, STAT_ACHIEVEMENT_TITANIC_TERROR_GREEK: 1 };
  const marks = sets([], [], [], ['ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS:ODIN', 'ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS:ZEUS',
    'ACHIEVEMENT_WE_HAVE_TITANS_AT_HOME:NORSE', 'ACHIEVEMENT_TITANIC_TERROR:NORSE', 'ACHIEVEMENT_TITANIC_TERROR:GREEK']);
  const [gods, home, titans] = buildAchievements({ schema, stats, strings, marks });

  const entry = (a, key) => a.checklist.find(c => c.key === key);
  assert.deepEqual([entry(gods, 'ZEUS').done, entry(gods, 'ZEUS').manual], [true, false], 'A tick on something the data shows is ignored.');
  assert.deepEqual([entry(gods, 'ODIN').done, entry(gods, 'ODIN').manual], [true, true]);
  assert.deepEqual(gods.progress, { value: 3, goal: 9 });
  assert.equal(gods.unlocked, false, 'Ticks show progress; the achievement itself is marked on its own.');

  assert.deepEqual(home.checklist.map(c => c.label), ['Griegos', 'Egyptians', 'Nórdicos', 'Atlanteans', 'Chinese', 'Japanese', 'Aztecs'],
    'Pantheons the game only counts can be ticked by name.');
  assert.deepEqual(home.progress, { value: 2, goal: 6 }, 'The game\'s count stays when it is ahead of the ticks.');

  assert.deepEqual(titans.checklist.map(c => [c.key, c.done, c.manual]),
    [['GREEK', true, false], ['EGYPTIAN', false, false], ['NORSE', true, true], ['ATLANTEAN', false, false]]);
  assert.deepEqual(titans.progress, { value: 2, goal: 4 });
});

test('achievements newer than the exported list still show, with what the servers know', () => {
  const schema = [ach('ACHIEVEMENT_A', 'a')];
  const full = completeSchema(schema, {
    steam: {
      ACHIEVEMENT_A: { name: { english: 'twice' }, desc: {} },
      ACHIEVEMENT_NEW_ONE: { name: { english: 'New One', spanish: 'Nuevo' }, desc: { english: 'Win 3 matches.' }, hidden: true,
        icon: `${'c'.repeat(40)}.jpg`, iconGray: `${'d'.repeat(40)}.jpg` },
    },
    achievementIds: { 1: 'ACHIEVEMENT_A', 2: 'ACHIEVEMENT_NEW_ONE', 3: 'ACHIEVEMENT_SECRET_THING', 4: 'not an achievement', 5: '<b>' },
    rarity: { ACHIEVEMENT_FROM_RARITY: 1.5 },
  });
  assert.deepEqual(full.map(a => a.api), ['ACHIEVEMENT_A', 'ACHIEVEMENT_NEW_ONE', 'ACHIEVEMENT_SECRET_THING', 'ACHIEVEMENT_FROM_RARITY']);
  assert.equal(full[0], schema[0], 'Known achievements are kept as they are.');

  const [, fresh, secret, rare] = buildAchievements({ schema: full, textLang: 'spanish', unlocks: new Map([['ACHIEVEMENT_SECRET_THING', 9]]), rarity: { ACHIEVEMENT_FROM_RARITY: 1.5 } });
  assert.deepEqual([fresh.name, fresh.desc, fresh.hidden, fresh.placeholder, fresh.unlocked], ['Nuevo', 'Win 3 matches.', true, false, false]);
  assert.match(fresh.icon, /dddd/);
  assert.deepEqual([secret.name, secret.desc, secret.placeholder, secret.unlocked, secret.unlockedAt, secret.icon], ['Secret Thing', '', true, true, 9, '']);
  assert.deepEqual([rare.name, rare.rarity], ['From Rarity', 1.5]);
  assert.deepEqual(completeSchema(schema), schema, 'Nothing from the servers changes nothing.');
});

test('icons only come from Steam hashes', () => {
  const [a] = buildAchievements({ schema: [ach('X', 'x', { iconGray: 'javascript:alert(1)' })] });
  assert.equal(a.icon, '');
});

// Rows shaped like the game servers' answers.
const badgeItem = (id, key, meta) => ({ id, name: `Badge${key}`, categories: [1003], meta: JSON.stringify(meta) });
const definitions = {
  items: [
    badgeItem(10000, 'TheSwift', { Tier: 1, GroupID: 1, Asset: 'resources/badge/the_swift.png', NameStrID: 'STR_BDGTTL_TITLE_NAME_01' }),
    { id: 10001, name: 'TitleTheSwift', categories: [1004], meta: '{}' },
    badgeItem(10072, 'ConquerorOfOlympus', { Tier: 1, GroupID: 23, Asset: 'resources/badge/conqueror_of_olympus.png', NameStrID: 'STR_BDGTTL_TITLE_NAME_59' }),
    badgeItem(10028, 'Demigod', { Tier: 3, GroupID: 8, Asset: 'resources/badge/demigod.png', NameStrID: 'STR_MISSING' }),
    badgeItem(10022, 'TheLucky', { Tier: 0, GroupID: 8, Asset: 'resources/badge/the_lucky.png' }),
    badgeItem(10032, 'MinotaurOverlord', { Tier: 1, GroupID: 9, Asset: 'resources/badge/minotaur_overlord.png' }),
  ],
  groups: [
    [1000, 'Persistent_TheSwift', 'x', 2, null, null, '{ "requirement_description": {"id": "STR_BDGTTL_OBJECTIVE_01", "params": ["12"]} }'],
    [1036, 'Persistent_ConquerorOfOlympus', 'x', 2, null, null, '{ "requirement_description": {"id": "STR_BDGTTL_OBJECTIVE_132", "params": ["STR_INGAME_HELP_HISTORY_TITLE_GREEK"]} }'],
    [1014, 'Persistent_Demigod', 'x', 2, null, null, '{ "requirement_description": {"id": "STR_BDGTTL_OBJECTIVE_10", "params": ["5", "STR_SW_HARD"]} }'],
    [1011, 'Persistent_TheLucky', 'x', 2, null, null, '{ "requirement_description": {"id": "STR_BDGTTL_OBJECTIVE_05", "params": ["5"]} }'],
    [1016, 'Persistent_MinotaurOverlord', 'x', 2, null, null, '{ "requirement_description": {"id": "", "params": []} }'],
  ],
  challenges: [
    [10000, 'BadgeChallenge_TheSwift', 'tracker', null, null, null, 1, ''],
    [10001, 'BadgeChallenge_TheSwift_Req01', 'Beat a Gauntlet Node in 12 minutes', null, null, null, 1, '{"Name":"PlayGame"}'],
    [10094, 'BadgeChallenge_ConquerorOfOlympus', 'tracker', null, null, null, 1, ''],
    [10095, 'BadgeChallenge_ConquerorOfOlympus_Req01', 'Zeus', null, null, null, 1, '{"RequireMajorGod":"Zeus"}'],
    // An older layout, with the group id before the name and more after the rule.
    [10096, 1036, 'BadgeChallenge_ConquerorOfOlympus_Req02', 'Hades', null, null, null, 1, '{"RequireMajorGod":"Hades"}', -1, -1, -1, 0],
    [10097, 'BadgeChallenge_ConquerorOfOlympus_Req03', 'Poseidon', null, null, null, 1, '{"RequireMajorGod":"Poseidon"}'],
    [10028, 'BadgeChallenge_Demigod', 'tracker', null, null, null, 1, ''],
    [10029, 'BadgeChallenge_Demigod_Req01', 'old', null, null, null, 3, '{}'],
    [10118, 'BadgeChallenge_Demigod_Req01_FIXED', 'Complete 5 labyrinth runs', null, null, null, 5, '{"Count":5}'],
    [10022, 'BadgeChallenge_TheLucky', 'tracker', null, null, null, 1, ''],
    [10023, 'BadgeChallenge_TheLucky_Req01', 'Complete 5 nodes without losing a life', null, null, null, 1,
      '{"Name":"AvatarStatCheck","RequireAvatarStatChecks":[{"avatarStatName":"STAT_GAUNTLET_NODES_ANY_DIFFICULTY_CURRENT_STREAK","comparison":">=","value":5}]}'],
    [10032, 'BadgeChallenge_MinotaurOverlord', 'tracker', null, null, null, 1, ''],
    [10033, 'BadgeChallenge_MinotaurOverlord_Req01', 'Defeat a labyrinth boss on any Difficulty', null, null, null, 1, '{}'],
    ['garbage'],
  ],
};

test('badges before any sync: earned from the inventory, the rest unknown, streaks from the statistics', () => {
  const list = buildBadges({ ...definitions, earned: { 10000: 1777118765 }, strings, stats: { STAT_GAUNTLET_NODES_ANY_DIFFICULTY_CURRENT_STREAK: 2 } });
  assert.deepEqual(list.map(b => b.key), ['TheSwift', 'TheLucky', 'Demigod', 'MinotaurOverlord', 'ConquerorOfOlympus'], 'Ordered by family, then tier.');
  const swift = list.find(b => b.key === 'TheSwift');
  assert.equal(swift.name, 'Veloz');
  assert.equal(swift.objective, 'Gana un nodo de Desafío en 12 minutos.');
  assert.equal(swift.art, 'the_swift');
  assert.equal(swift.status, 'earned');
  assert.equal(swift.earnedAt, 1777118765);

  const olympus = list.find(b => b.key === 'ConquerorOfOlympus');
  assert.equal(olympus.status, 'unknown');
  assert.equal(olympus.objective, 'Derrota a un jefe del Laberinto con cada dios mayor Griego.');
  assert.deepEqual(olympus.reqs.map(r => [r.id, r.label]), [[10095, 'Zeus'], [10096, 'Hades'], [10097, 'Poseidón']], 'Rows of either layout are read.');

  const lucky = list.find(b => b.key === 'TheLucky');
  assert.deepEqual([lucky.status, lucky.streak, lucky.value, lucky.goal], ['progress', true, 2, 5]);

  const demigod = list.find(b => b.key === 'Demigod');
  assert.equal(demigod.name, 'Demigod', 'Without the game text the name comes from the key.');
  assert.equal(demigod.goal, 5, 'The _FIXED requirement replaces the old one.');

  assert.equal(list.find(b => b.key === 'MinotaurOverlord').objective, 'Derrota a un jefe del Laberinto en cualquier dificultad.',
    'An empty goal from the server falls back to the game\'s own text.');
});

test('badges with progress from the game\'s cache: per god, counts, and earned ones stay complete', () => {
  const row = (id, done, count = 0, at = null) => ({ id, done, count, at });
  const progress = [row(10001, false), row(10094, false), row(10095, false), row(10096, true, 0, 1785107883), row(10097, false), row(10118, false, 3), row(10033, false)];
  const list = buildBadges({ ...definitions, earned: { 10000: 1777118765 }, progress, strings });
  const olympus = list.find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual([olympus.status, olympus.value, olympus.goal, olympus.known], ['progress', 1, 3, true]);
  assert.deepEqual(olympus.reqs.map(r => [r.label, r.done]), [['Zeus', false], ['Hades', true], ['Poseidón', false]]);

  const demigod = list.find(b => b.key === 'Demigod');
  assert.deepEqual([demigod.value, demigod.goal, demigod.status], [3, 5, 'progress']);
  assert.equal(demigod.objective, 'Completa 5 recorridos en Difícil o superior sin perder una vida.');

  assert.equal(list.find(b => b.key === 'TheSwift').status, 'earned', 'The game resets finished requirements to 0; the items still say earned.');
  assert.equal(list.find(b => b.key === 'MinotaurOverlord').status, 'none');

  const tracker = buildBadges({ ...definitions, earned: {}, progress: [row(10000, true, 0, 1777000000)] });
  assert.equal(tracker.find(b => b.key === 'TheSwift').earnedAt, 1777000000, 'A completed tracker counts as earned when the items lag.');
});

test('marks: earned badges and gods done, for whatever the data doesn\'t show', () => {
  const marks = sets([], [10072], [10095]);
  const marked = buildBadges({ ...definitions, strings, marks });
  const olympus = marked.find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual([olympus.earned, olympus.manual, olympus.earnedAt], [true, true, null]);
  const partial = buildBadges({ ...definitions, strings, marks: sets([], [], [10095]) }).find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual([partial.status, partial.value, partial.reqs[0].manual], ['progress', 1, true]);

  const synced = buildBadges({ ...definitions, earned: {}, strings, marks, progress: [] }).find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual([synced.earned, synced.manual], [true, true], 'Data without it keeps the mark.');
  const owned = buildBadges({ ...definitions, earned: { 10072: 50 }, strings, marks }).find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual([owned.earned, owned.manual, owned.earnedAt], [true, false, 50], 'Data wins over a mark.');
  const progress = [{ id: 10095, done: true, count: 0, at: 60 }];
  const ticked = buildBadges({ ...definitions, earned: {}, strings, marks: sets([], [], [10095, 10097]), progress })
    .find(b => b.key === 'ConquerorOfOlympus');
  assert.deepEqual(ticked.reqs.map(r => [r.label, r.done, r.manual]), [['Zeus', true, false], ['Hades', false, false], ['Poseidón', true, true]]);
  assert.deepEqual([ticked.status, ticked.value], ['progress', 2]);
});

test('no definitions yet means no badges', () => {
  assert.deepEqual(buildBadges({ strings }), []);
  assert.deepEqual(buildBadges(), []);
});

test('lists from several sources: the later ones win, and nothing is lost', () => {
  const shipped = {
    items: [{ id: 1, name: 'BadgeOld', categories: [1003], meta: '{}' }, { id: 2, name: 'BadgeSame', categories: [1003], meta: '{"Tier":0}' }],
    groups: [[1000, 'Persistent_Old', 'x', 2, null, null, '{}'], [1001, 'Persistent_Same', 'x', 2, null, null, '{"v":1}']],
    challenges: [[10, 'BadgeChallenge_Old', 'tracker', null, null, null, 1, '']],
    achievementIds: { 4: 'ACHIEVEMENT_A' },
    rarity: { ACHIEVEMENT_A: 10 },
  };
  const cache = {
    items: [{ id: 2, name: 'BadgeSame', categories: [1003], meta: '{"Tier":1}' }, { id: 3, name: 'BadgeNew', categories: [1003], meta: '{}' }],
    // The cache keeps the older row layout: the group id before the name.
    groups: [[1001, 'Persistent_Same', 'x', 2, null, null, -1, '{"v":2}']],
    challenges: [[11, 1001, 'BadgeChallenge_New', 'tracker', null, null, null, 1, '', -1, -1, -1, 0]],
    achievementIds: { 5: 'ACHIEVEMENT_B' },
  };
  const merged = mergeDefinitions(shipped, null, cache);
  assert.deepEqual(merged.items.map(i => [i.id, i.meta]), [[1, '{}'], [2, '{"Tier":1}'], [3, '{}']]);
  assert.deepEqual(merged.groups.map(g => g.at(-1)), ['{}', '{"v":2}']);
  assert.deepEqual(merged.challenges.map(c => c[0]), [10, 11]);
  assert.deepEqual(merged.achievementIds, { 4: 'ACHIEVEMENT_A', 5: 'ACHIEVEMENT_B' });
  assert.deepEqual(merged.rarity, { ACHIEVEMENT_A: 10 });
  assert.deepEqual(mergeDefinitions(), { items: [], groups: [], challenges: [], achievementIds: {}, rarity: {} });
});

test('unlocks and items from every source, with the earliest known time', () => {
  const steam = new Map([['ACHIEVEMENT_A', 300], ['ACHIEVEMENT_B', 0]]);
  const cache = unlocksByName({ 4: 200, 5: 100, 6: 50, 99: 1 }, { 4: 'ACHIEVEMENT_A', 5: 'ACHIEVEMENT_B', 6: 'ACHIEVEMENT_C' });
  assert.deepEqual([...cache], [['ACHIEVEMENT_A', 200], ['ACHIEVEMENT_B', 100], ['ACHIEVEMENT_C', 50]], 'Numbers the list doesn\'t name are left out.');
  assert.deepEqual(Object.fromEntries(mergeUnlocks(steam, null, cache)), { ACHIEVEMENT_A: 200, ACHIEVEMENT_B: 100, ACHIEVEMENT_C: 50 });
  assert.equal(mergeUnlocks(null, undefined), null, 'Nothing known stays unknown.');
  assert.equal(unlocksByName(null, {}), null);
  assert.deepEqual(Object.fromEntries(mergeUnlocks(new Map([['X', 0]]), new Map([['X', 0]]))), { X: 0 });

  assert.deepEqual(mergeEarned({ 10000: 50, 10001: 0 }, null, { 10000: 40, 10001: 70, 10002: 0 }), { 10000: 40, 10001: 70, 10002: 0 });
  assert.equal(mergeEarned(null), null);
});

test('views filter, search without accents and sort', () => {
  const list = [
    { name: 'Poseidón', desc: 'x', unlocked: false, ratio: 0.5, order: 0, category: 'story', unlockedAt: null, rarity: 3 },
    { name: 'Annihilation', desc: 'Defeat units', unlocked: true, ratio: 1, order: 1, category: 'matches', unlockedAt: 20, rarity: 40 },
    { name: 'Zeus', desc: 'y', unlocked: false, ratio: 0, order: 2, category: 'matches', unlockedAt: null, rarity: null,
      checklist: [{ label: 'Cástor', done: true }] },
    { name: 'Boom', desc: 'z', unlocked: true, ratio: 1, order: 3, category: 'story', unlockedAt: 30, rarity: 1 },
  ];
  assert.ok(matches(list[0], 'poseidon'));
  assert.ok(matches(list[2], 'castor'), 'Checklist names are searched too.');
  assert.ok(!matches(list[1], 'zeus'));
  assert.deepEqual(viewAchievements(list, { state: 'locked' }).map(a => a.name), ['Poseidón', 'Zeus']);
  assert.deepEqual(viewAchievements(list, { state: 'progress' }).map(a => a.name), ['Poseidón']);
  assert.deepEqual(viewAchievements(list, { category: 'story', sort: 'game' }).map(a => a.name), ['Poseidón', 'Boom']);
  assert.deepEqual(viewAchievements(list, { sort: 'recent' }).map(a => a.name), ['Boom', 'Annihilation', 'Poseidón', 'Zeus']);
  assert.deepEqual(viewAchievements(list, { sort: 'rarity' }).map(a => a.name), ['Boom', 'Poseidón', 'Annihilation', 'Zeus']);
  assert.deepEqual(viewAchievements(list, { sort: 'name' }).map(a => a.name), ['Annihilation', 'Boom', 'Poseidón', 'Zeus']);
  assert.deepEqual(closest(list, a => a.unlocked).map(a => a.name), ['Poseidón']);
  assert.deepEqual(summary(list, a => a.unlocked), { done: 2, total: 4, ratio: 0.5 });

  const badges = [
    { name: 'B', earned: true, status: 'earned', earnedAt: 5, ratio: 1, order: 0 },
    { name: 'A', earned: false, status: 'progress', earnedAt: null, ratio: 0.3, order: 1 },
    { name: 'C', earned: false, status: 'none', earnedAt: null, ratio: 0, order: 2 },
  ];
  assert.deepEqual(viewBadges(badges, { state: 'missing' }).map(b => b.name), ['A', 'C']);
  assert.deepEqual(viewBadges(badges, { state: 'progress' }).map(b => b.name), ['A']);
  assert.deepEqual(viewBadges(badges, { sort: 'closest' }).map(b => b.name), ['A', 'C', 'B']);
});
