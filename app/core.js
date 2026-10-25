// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// The tracker's logic, apart from the page: from the decoded files (files.js), the game's texts and the servers'
// definitions to the cards the page shows. No DOM here, so node:test can check all of it. Everything about which
// achievements and badges exist comes from data, so game updates show up without code changes; the lists below only
// name what the game stores as bare numbers, and anything new in those numbers still counts and shows as "#n".

/** Major gods by civilization id (1-based, the game's order). Connoisseur of the Gods keeps one bit per civ id. */
export const GODS = ['ZEUS', 'HADES', 'POSEIDON', 'RA', 'ISIS', 'SET', 'THOR', 'ODIN', 'LOKI', 'KRONOS', 'ORANOS', 'GAIA',
  'FREYR', 'FUXI', 'NUWA', 'SHENNONG', 'AMATERASU', 'TSUKUYOMI', 'SUSANOO', 'DEMETER', 'HUITZILOPOCHTLI', 'TEZCATLIPOCA', 'QUETZALCOATL'];

/** Gauntlet legends in the game's order (gauntlet.xml): A Legendary Rush keeps one bit per legend, from 0. */
export const LEGENDS = [
  ['STR_CHARACTER_KASTOR', 'Kastor'], ['STR_CHARACTER_GARG', 'Gargarensis'], ['STR_CHARACTER_CIRCE', 'Circe'],
  ['STR_CHARACTER_KAMO', 'Kamos'], ['STR_CHARACTER_AMAN', 'Amanra'], ['STR_TUT_M0_PLAYER_02', 'Theris'],
  ['STR_CHARACTER_SETN', 'Setna'], ['STR_CHARACTER_REGI', 'Reginleif'], ['STR_CHARACTER_FOLS', 'Folstag'],
  ['STR_CHARACTER_HALO', 'Halogi'], ['STR_MAS_02_CHARACTER_YFF', 'Yan Feifeng'], ['STR_TECH_CHIYOU_NAME', 'Chiyou'],
  ['STR_MAS_03_CHARACTER_SHIJI', 'Nüchou'],
];

/** Achievements whose statistic is a set of bits: which gods or legends won a final boss node, or how many titans. */
const BITSETS = {
  ACHIEVEMENT_CONNOISSEUR_OF_THE_GODS: { kind: 'gods', goal: 9 },
  ACHIEVEMENT_A_LEGENDARY_RUSH: { kind: 'legends', goal: 5 },
  ACHIEVEMENT_WE_HAVE_TITANS_AT_HOME: { kind: 'count', goal: 6 },
};

/** Game texts for the parts of achievements counted per part (STAT_<api>_<PART>). Unknown parts show their own name. */
const PART_NAMES = {
  GREEK: ['STR_CULTURE_GREEKS', 'Greeks'], EGYPTIAN: ['STR_CULTURE_EGYPTIANS', 'Egyptians'], NORSE: ['STR_CULTURE_NORSE', 'Norse'],
  ATLANTEAN: ['STR_CULTURE_ATLANTEANS', 'Atlanteans'], CHINESE: ['STR_CULTURE_CHINESE', 'Chinese'], JAPANESE: ['STR_CULTURE_JAPANESE', 'Japanese'],
  AZTEC: ['STR_CULTURE_AZTECS', 'Aztecs'], FOOD: ['STR_RESOURCE_FOOD_NAME', 'Food'], WOOD: ['STR_RESOURCE_WOOD_NAME', 'Wood'],
};

/** The parts each achievement needs, for the ones the game counts per part; parts a file has beyond these show too. */
const PARTS = {
  ACHIEVEMENT_TITANIC_TERROR: ['GREEK', 'EGYPTIAN', 'NORSE', 'ATLANTEAN'],
  ACHIEVEMENT_EMBARRASSMENT_OF_RICHES: ['FOOD', 'WOOD'],
};

/** The pantheons, for achievements the game counts per pantheon without saying which. */
const CULTURES = Object.fromEntries(['GREEK', 'EGYPTIAN', 'NORSE', 'ATLANTEAN', 'CHINESE', 'JAPANESE', 'AZTEC'].map(k => [k, PART_NAMES[k]]));

/** Badges whose challenge names no goal text; these game texts say the same. */
const OBJECTIVES = {
  TheUnscathed: { id: 'STR_BDGTTL_OBJECTIVE_61', params: [] },
  MinotaurOverlord: { id: 'STR_BDGTTL_OBJECTIVE_11', params: [] },
};

const BADGE_CATEGORY = 1003;
const ICON_CDN = 'https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/1934680/';
const NO_MARKS = { achievements: new Set(), checks: new Set(), badges: new Set(), reqs: new Set() };

/** A game text, or the fallback when the game's texts aren't available. */
export const text = (strings, id, fallback) => (id && strings?.[id]) || fallback;

/** Fills {0}, {1}... like the game's texts. */
export const format = (template, params = []) => String(template).replace(/\{(\d+)\}/g, (m, i) => (params[i] ?? m));

/** The goal in an English achievement text: its first number ("Defeat 10000 units" is 10000). */
export function goalOf(en) {
  const m = /\d[\d,]*/.exec(en || '');
  const n = m ? Number(m[0].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n >= 2 ? n : null;
}

/** The set bits of a statistic, from bit 0. Values reach 2^53 at most, so plain numbers do. */
export function setBits(value) {
  const bits = [];
  let v = Math.max(0, Math.floor(Number(value) || 0));
  for (let i = 0; v > 0 && i < 53; i++, v = Math.floor(v / 2)) if (v % 2 === 1) bits.push(i);
  return bits;
}

/** Where an achievement belongs: the campaigns and battles, the Gauntlet, the Arena of the Gods, or any match. */
export function categoryOf(api, en) {
  if (api.startsWith('ACHIEVEMENT_AOTG_')) return 'arena';
  if (/gauntlet|favor stash|badge/i.test(en)) return 'gauntlet';
  if (/campaign|scenario|mission|tutorial|mythical battle|fall of the trident|'hells divided'|'endless hunger'|delivery service/i.test(en)) return 'story';
  return 'matches';
}

/** Steam's language key for the texts of a language of the page; Mexican Spanish when the game uses it. */
export const steamTextLanguage = (lang, gameLanguage) => (lang === 'es' ? (gameLanguage === 'latam' ? 'latam' : 'spanish') : 'english');

const titleCase = word => word.charAt(0) + word.slice(1).toLowerCase();
const words = key => key.replace(/(?<=[a-z])(?=[A-Z])/g, ' ');
const iconUrl = hash => (/^[0-9a-f]{40}\.(jpg|png)$/i.test(hash || '') ? ICON_CDN + hash : '');
const parseJson = value => {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Steam's achievement list, completed with what the servers know of newer ones: the texts and icons of Steam's Web
 * API when the site has them, else just the name, so a new achievement shows (and can be marked) before the next export.
 */
export function completeSchema(schema = [], { steam = {}, achievementIds = {}, rarity = {} } = {}) {
  const known = new Set(schema.map(a => a.api));
  const extra = [];
  const add = (api, entry) => {
    if (known.has(api) || !/^ACHIEVEMENT_[A-Z0-9_]+$/.test(api)) return;
    known.add(api);
    extra.push({ api, block: -1, bit: -1, hidden: false, icon: '', iconGray: '', ...entry });
  };
  for (const [api, a] of Object.entries(steam ?? {})) {
    add(api, { name: { ...a.name }, desc: { ...a.desc }, hidden: !!a.hidden, icon: a.icon ?? '', iconGray: a.iconGray ?? '' });
  }
  for (const api of [...Object.values(achievementIds ?? {}), ...Object.keys(rarity ?? {})]) {
    add(api, { name: { english: api.slice('ACHIEVEMENT_'.length).split('_').map(titleCase).join(' ') }, desc: {}, placeholder: true });
  }
  return [...schema, ...extra];
}

/**
 * Every achievement with what the page needs. Unlocked comes from Steam's file or the game's servers; without
 * either, from the game's statistics when a counter reached its goal; and the player can mark any other one, which is
 * how console players track theirs. For locked ones: how far along the player is, as a counter against the goal in
 * the text, or a checklist (gods, legends, parts) whose entries can be ticked by hand too.
 */
export function buildAchievements({ schema = [], textLang = 'english', unlocks = null, stats = null, strings = {}, rarity = {}, marks = NO_MARKS } = {}) {
  const values = stats ?? {};
  // STAT_<api>_<PART> is a part of <api>, unless it is the statistic of another achievement.
  const own = new Set(schema.map(a => `STAT_${a.api}`));
  const partsOf = stat => Object.keys(values).filter(k => k.startsWith(`${stat}_`) && !own.has(k)).map(k => k.slice(stat.length + 1));
  return schema.map((a, order) => {
    const known = unlocks != null;
    const time = known ? unlocks.get(a.api) : undefined;
    const fromData = time !== undefined;
    const en = a.desc.english ?? '';
    const stat = `STAT_${a.api}`;
    const check = (key, label, done) => {
      const marked = !done && marks.checks.has(`${a.api}:${key}`);
      return { key, label, done: done || marked, manual: marked };
    };

    let checklist = null;
    let goal = null;
    let counted = 0;
    if (BITSETS[a.api]) {
      const { kind } = BITSETS[a.api];
      const bits = setBits(values[stat]);
      goal = BITSETS[a.api].goal;
      counted = bits.length;
      if (kind === 'gods') checklist = listed(GODS.map((god, i) => [i + 1, god, text(strings, `STR_CIV_${god}`, titleCase(god))]), bits, check);
      if (kind === 'legends') checklist = listed(LEGENDS.map(([id, name], i) => [i, id, text(strings, id, name)]), bits, check);
      // The game counts pantheons without naming them, so these are only for ticking by hand.
      if (kind === 'count') checklist = Object.entries(CULTURES).map(([key, [id, name]]) => check(key, text(strings, id, name), false));
    } else if (PARTS[a.api] || partsOf(stat).length) {
      const parts = [...new Set([...(PARTS[a.api] ?? []), ...partsOf(stat)])];
      checklist = parts.map(part => check(part, text(strings, PART_NAMES[part]?.[0], PART_NAMES[part]?.[1] ?? titleCase(part)), fromData || (values[`${stat}_${part}`] ?? 0) > 0));
      goal = checklist.length;
      counted = checklist.filter(c => c.done && !c.manual).length;
    } else if (stat in values) {
      goal = goalOf(en);
      counted = Number(values[stat]) || 0;
    }
    const byHand = checklist?.filter(c => c.manual).length ?? 0;
    // A statistic that reached its goal means unlocked, when neither Steam nor the servers said.
    const inferred = !known && goal != null && counted >= goal;
    const source = fromData ? 'data' : inferred ? 'stats' : marks.achievements.has(a.api) ? 'mark' : null;
    const unlocked = source != null;
    const progress = goal ? { value: unlocked ? goal : Math.min(BITSETS[a.api]?.kind === 'count' ? Math.max(counted, byHand) : counted + byHand, goal), goal } : null;
    return {
      api: a.api,
      name: a.name[textLang] || a.name.english || a.api,
      desc: a.desc[textLang] || en,
      hidden: a.hidden,
      placeholder: !!a.placeholder,
      order,
      known,
      source,
      manual: source === 'mark',
      unlocked,
      unlockedAt: time > 0 ? time : null,
      // The game's own picture is resources\achievements\<api in lower case>.dds; Steam's icon is the fallback.
      art: a.api.toLowerCase(),
      icon: iconUrl(unlocked ? a.icon || a.iconGray : a.iconGray || a.icon),
      category: categoryOf(a.api, en),
      rarity: Number.isFinite(rarity?.[a.api]) ? rarity[a.api] : null,
      progress,
      checklist,
      ratio: unlocked ? 1 : progress ? progress.value / progress.goal : 0,
    };
  });
}

/** A checklist from known [bit, key, label] entries, plus "#n" for any set bit the list doesn't know yet. */
function listed(known, bits, check) {
  const list = known.map(([bit, key, label]) => check(key, label, bits.includes(bit)));
  for (const bit of bits) if (!known.some(([b]) => b === bit)) list.push(check(String(bit), `#${bit}`, true));
  return list;
}

/** A badge goal in the game's words: the challenge's text id with its values, which may be text ids themselves. */
function objectiveOf(description, strings) {
  if (!description?.id || !strings?.[description.id]) return null;
  const params = (description.params ?? []).map(p => (typeof p === 'string' && p.startsWith('STR_') ? text(strings, p, p) : String(p)));
  return format(strings[description.id], params);
}

// Server rows are positional arrays whose layout has changed before, so fields are found by what they look like:
// the name by its prefix, the rule as the last JSON text, the target as the number just before it.
const isRule = value => typeof value === 'string' && /^\s*\{/.test(value);

function readGroup(row) {
  const name = Array.isArray(row) ? row.find(v => typeof v === 'string' && v.startsWith('Persistent_')) : null;
  return name ? { key: name.slice('Persistent_'.length), meta: parseJson(row.findLast(isRule)) } : null;
}

function readChallenge(row) {
  if (!Array.isArray(row)) return null;
  const at = row.findIndex(v => typeof v === 'string' && v.startsWith('BadgeChallenge_'));
  const m = at > 0 ? /^BadgeChallenge_(.+?)(?:_Req(\d+))?(_FIXED)?$/.exec(row[at]) : null;
  if (!m) return null;
  const ruleAt = row.findLastIndex(isRule);
  return {
    id: row[0],
    key: m[1],
    req: m[2] ? Number(m[2]) : null,
    fixed: !!m[3],
    desc: typeof row[at + 1] === 'string' ? row[at + 1] : '',
    target: ruleAt > 0 && Number(row[ruleAt - 1]) > 0 ? Number(row[ruleAt - 1]) : 1,
    rule: parseJson(row[ruleAt]),
  };
}

/**
 * Every badge: its art name, name and goal in the game's words, earned or not (the player's items, or a completed
 * challenge), and progress from the game's cache: each god of an "all gods" badge, or a count such as 3 of 5 runs. A
 * streak badge shows the current streak from the game's statistics. The player can mark any badge or god the data
 * doesn't show as done. Without progress data, badges that aren't earned have status "unknown".
 */
export function buildBadges({ items = [], groups = [], challenges = [], earned = null, progress = null, strings = {}, stats = null, marks = NO_MARKS } = {}) {
  const values = stats ?? {};
  const goals = new Map();
  for (const group of (Array.isArray(groups) ? groups : []).map(readGroup)) if (group) goals.set(group.key, group.meta.requirement_description);

  const found = new Map();
  for (const c of (Array.isArray(challenges) ? challenges : []).map(readChallenge)) {
    if (!c) continue;
    const entry = found.get(c.key) ?? { tracker: null, reqs: new Map() };
    if (c.req == null) entry.tracker = c.id;
    else if (c.fixed || !entry.reqs.has(c.req)) entry.reqs.set(c.req, c);
    found.set(c.key, entry);
  }

  // Progress per challenge, from the game's cache: { id, done, count, at }.
  const known = Array.isArray(progress);
  const rows = new Map();
  for (const p of known ? progress : []) if (p?.id != null) rows.set(p.id, p);

  const badges = items.filter(item => item.categories?.includes(BADGE_CATEGORY)).map(item => {
    const meta = parseJson(item.meta);
    const key = item.name.replace(/^Badge/, '');
    const challenge = found.get(key) ?? { tracker: null, reqs: new Map() };
    const tracker = challenge.tracker != null ? rows.get(challenge.tracker) : null;
    const owned = earned?.[item.id];
    const fromData = owned != null || !!tracker?.done;
    const manual = !fromData && marks.badges.has(item.id);
    const earnedAt = owned != null ? owned : tracker?.done ? tracker.at ?? 0 : manual ? 0 : null;
    const isEarned = earnedAt != null;

    const reqs = [...challenge.reqs.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => {
      const p = rows.get(r.id);
      const god = r.rule?.RequireMajorGod;
      const mark = !isEarned && !p?.done && marks.reqs.has(r.id);
      return {
        id: r.id,
        label: god ? text(strings, `STR_CIV_${String(god).toUpperCase()}`, String(god)) : null,
        target: r.target,
        count: isEarned ? r.target : Math.min(p?.count ?? 0, r.target),
        done: isEarned || !!p?.done || mark,
        manual: mark,
        at: p?.at ?? null,
        rule: r.rule,
      };
    });

    let value = isEarned ? 1 : 0;
    let goal = 1;
    let streak = false;
    if (reqs.length > 1) {
      goal = reqs.length;
      value = reqs.filter(r => r.done).length;
    } else if (reqs.length === 1 && reqs[0].target > 1) {
      goal = reqs[0].target;
      value = reqs[0].done ? goal : reqs[0].count;
    } else if (reqs.length === 1 && Array.isArray(reqs[0].rule?.RequireAvatarStatChecks)) {
      // "Complete N nodes without losing a life": the game's own counter of the current streak.
      const check = reqs[0].rule.RequireAvatarStatChecks[0];
      if (check?.avatarStatName && Number(check.value) > 1) {
        goal = Number(check.value);
        value = isEarned ? goal : Math.min(Number(values[check.avatarStatName]) || 0, goal);
        streak = true;
      }
    }

    const marked = reqs.some(r => r.manual);
    const status = isEarned ? 'earned' : value > 0 && (known || streak || marked) ? 'progress' : known ? 'none' : 'unknown';
    const fromServer = goals.get(key);
    const description = fromServer?.id ? fromServer : OBJECTIVES[key];
    const art = /([a-z0-9_]+)\.png$/i.exec(meta.Asset || '')?.[1]?.toLowerCase() ?? null;
    return {
      id: item.id,
      key,
      name: text(strings, meta.NameStrID, words(key)),
      objective: objectiveOf(description, strings) ?? challenge.reqs.values().next().value?.desc ?? '',
      tier: Number(meta.Tier) || 0,
      family: Number(meta.GroupID) || 0,
      art,
      earned: isEarned,
      earnedAt: isEarned && earnedAt > 0 ? earnedAt : null,
      manual,
      known,
      reqs: reqs.length > 1 ? reqs.map(({ id, label, done, manual: byHand, at }) => ({ id, label, done, manual: byHand, at })) : [],
      value,
      goal,
      streak,
      status,
      ratio: isEarned ? 1 : value / goal,
    };
  });
  return badges.sort((a, b) => a.family - b.family || a.tier - b.tier || a.id - b.id).map((badge, order) => ({ ...badge, order }));
}

/**
 * The badge, challenge and achievement lists from several sources, the later ones winning: what the site ships, then
 * the game's own cache (the installed version), then what the servers said on the desktop's last refresh.
 */
export function mergeDefinitions(...sources) {
  const items = new Map();
  const groups = new Map();
  const challenges = new Map();
  const achievementIds = {};
  const rarity = {};
  for (const source of sources) {
    if (!source) continue;
    for (const item of Array.isArray(source.items) ? source.items : []) if (item?.id != null) items.set(item.id, item);
    for (const row of Array.isArray(source.groups) ? source.groups : []) {
      const group = readGroup(row);
      if (group) groups.set(group.key, row);
    }
    for (const row of Array.isArray(source.challenges) ? source.challenges : []) if (Array.isArray(row)) challenges.set(row[0], row);
    Object.assign(achievementIds, source.achievementIds);
    Object.assign(rarity, source.rarity);
  }
  return { items: [...items.values()], groups: [...groups.values()], challenges: [...challenges.values()], achievementIds, rarity };
}

const earliest = (a, b) => (a > 0 && b > 0 ? Math.min(a, b) : a > 0 ? a : b > 0 ? b : 0);

/** Unlocked achievements from every source that knows: name to the earliest time any of them has. Null when none knows. */
export function mergeUnlocks(...maps) {
  const known = maps.filter(Boolean);
  if (!known.length) return null;
  const merged = new Map();
  for (const map of known) for (const [api, at] of map) merged.set(api, earliest(merged.get(api) ?? 0, Number(at) || 0));
  return merged;
}

/** Achievements by the game servers' numbers ({ id: time }, from the cache or the public profile), by name. */
export function unlocksByName(byId, achievementIds) {
  if (!byId) return null;
  const named = new Map();
  for (const [id, at] of Object.entries(byId)) if (achievementIds?.[id]) named.set(achievementIds[id], Number(at) || 0);
  return named;
}

/** The player's items from every source that knows ({ itemId: time }), each with its earliest time. Null when none knows. */
export function mergeEarned(...sources) {
  const known = sources.filter(Boolean);
  if (!known.length) return null;
  const merged = {};
  for (const source of known) for (const [id, at] of Object.entries(source)) merged[id] = earliest(merged[id] ?? 0, Number(at) || 0);
  return merged;
}

/** Counts for the header: how many of all, and the share. */
export function summary(list, isDone) {
  const done = list.filter(isDone).length;
  return { done, total: list.length, ratio: list.length ? done / list.length : 0 };
}

/** The locked ones the player is nearest to, best first: the "next up" row. */
export function closest(list, isDone, count = 4) {
  return list.filter(x => !isDone(x) && x.ratio > 0 && x.ratio < 1).sort((a, b) => b.ratio - a.ratio || a.order - b.order).slice(0, count);
}

const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Search across names, descriptions and checklist names, ignoring case and accents. */
export function matches(item, query) {
  const q = fold(query).trim();
  if (!q) return true;
  const haystack = fold([item.name, item.desc, item.objective, ...(item.checklist ?? []).map(c => c.label), ...(item.reqs ?? []).map(r => r.label)].join(' '));
  return q.split(/\s+/).every(part => haystack.includes(part));
}

/** Achievements filtered by state ("all", "locked", "unlocked", "progress") and category, then sorted. */
export function viewAchievements(list, { query = '', state = 'all', category = 'all', sort = 'closest' } = {}) {
  const shown = list.filter(a =>
    (state === 'all' || (state === 'locked' && !a.unlocked) || (state === 'unlocked' && a.unlocked) || (state === 'progress' && !a.unlocked && a.ratio > 0))
    && (category === 'all' || a.category === category)
    && matches(a, query));
  return sortItems(shown, sort, a => a.unlocked, a => a.unlockedAt);
}

/** Badges filtered by state ("all", "earned", "missing", "progress"), then sorted. */
export function viewBadges(list, { query = '', state = 'all', sort = 'game' } = {}) {
  const shown = list.filter(b =>
    (state === 'all' || (state === 'earned' && b.earned) || (state === 'missing' && !b.earned) || (state === 'progress' && b.status === 'progress'))
    && matches(b, query));
  return sortItems(shown, sort, b => b.earned, b => b.earnedAt);
}

function sortItems(list, sort, isDone, doneAt) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorted = [...list];
  if (sort === 'closest') sorted.sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || b.ratio - a.ratio || a.order - b.order);
  else if (sort === 'recent') sorted.sort((a, b) => (doneAt(b) ?? -1) - (doneAt(a) ?? -1) || byName(a, b));
  else if (sort === 'name') sorted.sort(byName);
  else if (sort === 'rarity') sorted.sort((a, b) => (a.rarity ?? 101) - (b.rarity ?? 101) || byName(a, b));
  return sorted;
}
