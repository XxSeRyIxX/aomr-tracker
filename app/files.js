// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// The player's files, decoded in the page, the same way in both editions: the website reads what the player drops on
// it, the desktop app what it finds (/local/). Where they come from:
// - the game's folder: its cache of what the game servers said (temp/RLink: the player's achievements, items and
//   badge progress, and the lists of badges, challenges and achievements of the installed version), and its
//   statistics (users/lcs.dat), behind the counters;
// - Steam (appcache/stats): the achievement list and one account's unlocks, both optional;
// - the public profile's pages on the game servers, for consoles: read by the desktop app or through the website's
//   relay, or opened and pasted in by the player.

/** The game on Steam: its files carry this id. */
const APP_ID = '1934680';

// The game builds this key and IV at startup to encrypt its user files.
const STATS_KEY = '340730320C4D6A060101010205070901315A084C4D51573132584C4159434446';
const STATS_IV = '4F5431534631590F4D6A203508706802';

const hexBytes = hex => Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16));
const isIndex = key => /^\d+$/.test(key);
const byNumber = (a, b) => Number(a) - Number(b);
const list = value => (Array.isArray(value) ? value : []);
const whole = value => (value != null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null);

/** Every file the tracker reads, by name. The cache's names end in the game build, such as "-live-release21.dat". */
const KINDS = [
  ['cache', /^\w*?item-athens-[\w.-]+\.dat$/i],
  ['items', /^ItemCategoryCache-athens-[\w.-]+\.dat$/i],
  ['challenges', /^ChallengeGetChallengesCache-athens-[\w.-]+\.dat$/i],
  ['achievementIds', /^GetAvailableAchievementsCache-athens-[\w.-]+\.dat$/i],
  ['stats', /^lcs\.dat$/i],
  ['steamUser', new RegExp(`^UserGameStats_\\d+_${APP_ID}\\.bin$`, 'i')],
  ['steamSchema', new RegExp(`^UserGameStatsSchema_${APP_ID}\\.bin$`, 'i')],
];

/** Which file a name is: "cache", "items", "challenges", "achievementIds", "stats", "steamUser", "steamSchema" or null. */
export function fileKind(name) {
  return KINDS.find(([, pattern]) => pattern.test(name ?? ''))?.[0] ?? null;
}

const buildOf = name => Number(/release(\d+)/i.exec(name)?.[1] ?? -1);

/**
 * The file to read for each kind, from everything found in a dropped folder: the newest game build first, then the
 * newest file. Old builds leave their cache behind, and a computer can hold several players' statistics.
 */
export function pickFiles(files) {
  const best = {};
  for (const file of files) {
    const kind = fileKind(file.name);
    if (!kind) continue;
    const known = best[kind];
    const newer = !known || buildOf(file.name) > buildOf(known.name)
      || (buildOf(file.name) === buildOf(known.name) && (file.lastModified ?? 0) > (known.lastModified ?? 0));
    if (newer) best[kind] = file;
  }
  return best;
}

/**
 * Steam's binary KeyValues: a type byte, a NUL-terminated name, then the value. Type 0 opens a section that type 8
 * closes. Sections become objects without a prototype, so no name in a file can reach Object.prototype.
 */
export function parseKeyValues(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let pos = 0;
  const take = count => {
    if (pos + count > bytes.length) throw new Error('KeyValues data ends early.');
    const at = pos;
    pos += count;
    return at;
  };
  const text = () => {
    const end = bytes.indexOf(0, pos);
    if (end < 0) throw new Error('KeyValues text never ends.');
    const value = decoder.decode(bytes.subarray(pos, end));
    pos = end + 1;
    return value;
  };
  const section = depth => {
    if (depth > 32) throw new Error('KeyValues nested too deep.');
    const values = Object.create(null);
    while (pos < bytes.length) {
      const type = bytes[pos++];
      if (type === 8 || type === 11) return values;
      const name = text();
      switch (type) {
        case 0: values[name] = section(depth + 1); break;
        case 1: values[name] = text(); break;
        case 2: case 4: case 6: values[name] = view.getInt32(take(4), true); break;
        case 3: values[name] = view.getFloat32(take(4), true); break;
        case 7: values[name] = Number(view.getBigUint64(take(8), true)); break;
        case 10: values[name] = Number(view.getBigInt64(take(8), true)); break;
        default: throw new Error(`Unknown KeyValues type ${type}.`);
      }
    }
    return values;
  };
  return section(0);
}

const lowerKeys = texts => Object.fromEntries(Object.entries(texts ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));

/**
 * Steam's achievement list (UserGameStatsSchema_<app>.bin), in the game's order. Names and descriptions are kept in
 * every language the file has, under Steam's language keys ("english", "spanish", "latam"...).
 */
export function readSchema(root) {
  const stats = root?.[APP_ID]?.stats;
  if (!stats) throw new Error('Not the achievement list of Age of Mythology: Retold.');
  const found = [];
  for (const block of Object.keys(stats).filter(isIndex).sort(byNumber)) {
    const bits = stats[block]?.bits ?? {};
    for (const bit of Object.keys(bits).filter(isIndex).sort(byNumber)) {
      const entry = bits[bit];
      const display = entry?.display;
      if (typeof entry?.name !== 'string' || !display || Number(bit) > 31) continue;
      found.push({
        api: entry.name,
        block: Number(block),
        bit: Number(bit),
        name: lowerKeys(display.name),
        desc: lowerKeys(display.desc),
        hidden: String(display.hidden) === '1',
        icon: String(display.icon ?? ''),
        iconGray: String(display.icon_gray ?? ''),
      });
    }
  }
  return found;
}

/** One account's unlocks (UserGameStats_<account>_<app>.bin): achievement name to Unix seconds, 0 when Steam kept no time. */
export function readUnlocks(root, schema) {
  const cache = root?.cache;
  if (!cache) throw new Error('Not a Steam achievement file.');
  const unlocks = new Map();
  for (const a of schema) {
    const block = cache[a.block];
    if (block && ((Number(block.data) >>> a.bit) & 1) === 1) unlocks.set(a.api, Number(block.AchievementTimes?.[a.bit]) || 0);
  }
  return unlocks;
}

/**
 * The game's statistics (users/lcs.dat): an int32 of -(n + 1) and n bytes of filler (128 to 256), then AES-256-CBC of
 * a version, the player's id and named 64-bit values. Returns { playerId, values }.
 */
export async function readStats(buffer, subtle = globalThis.crypto.subtle) {
  const raw = new Uint8Array(buffer);
  if (raw.length < 20) throw new Error('The statistics file is too short.');
  const filler = -new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true) - 1;
  const start = filler >= 128 && filler <= 256 ? filler + 4 : 0;
  const key = await subtle.importKey('raw', hexBytes(STATS_KEY), 'AES-CBC', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: hexBytes(STATS_IV) }, key, raw.subarray(start)));
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const utf16 = new TextDecoder('utf-16le');
  let pos = 0;
  const int = () => {
    const value = view.getInt32(pos, true);
    pos += 4;
    return value;
  };
  const text = () => {
    const length = int();
    if (length < 0 || length > 4096 || pos + length * 2 > plain.length) throw new Error('The statistics file is damaged.');
    const value = utf16.decode(plain.subarray(pos, pos + length * 2));
    pos += length * 2;
    return value;
  };
  int();
  const playerId = text();
  const count = int();
  if (count < 0 || count > 100_000) throw new Error('The statistics file is damaged.');
  const values = Object.create(null);
  for (let i = 0; i < count; i++) {
    const name = text();
    values[name] = Number(view.getBigInt64(pos, true));
    pos += 8;
  }
  return { playerId, values };
}

const inflate = bytes => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text();

/** A zlib stream followed by zero padding: the stream's checksum may end in zeros too, so they are put back one by one. */
async function inflatePadded(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let failure = new Error('Empty cache file.');
  for (let extra = 0; extra <= 4 && end + extra <= bytes.length; extra++) {
    try {
      return await inflate(bytes.subarray(0, end + extra));
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
}

/**
 * One of the game's cache files (temp/RLink). The lists are an int32 version, an int32 size, zlib-compressed JSON and
 * zero padding. The player's own file adds a signature first: an int32 version, the signature's length and its base64
 * text, then the unpacked and packed sizes and the zlib stream. Returns, by what the JSON holds:
 * { kind: "cache", profileId, playerId, alias, platform, unlocked, earned, progress }, { kind: "items", items },
 * { kind: "challenges", groups, challenges } or { kind: "achievementIds", achievementIds }.
 */
export async function readGameCache(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) throw new Error('Not one of the game\'s cache files.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text;
  if (bytes[8] === 0x78) {
    text = await inflatePadded(bytes.subarray(8));
  } else {
    const signature = view.getInt32(4, true);
    const at = 8 + signature;
    const packed = signature > 0 && signature <= 4096 && at + 8 <= bytes.length ? view.getInt32(at + 4, true) : -1;
    if (packed < 2 || at + 8 + packed > bytes.length) throw new Error('Not one of the game\'s cache files.');
    text = await inflate(bytes.subarray(at + 8, at + 8 + packed));
  }
  return readCacheData(JSON.parse(text.replace(/\0+$/, '')));
}

const PLATFORMS = { steam: 'Steam', xboxlive: 'Xbox', xbox: 'Xbox', psn: 'PlayStation', playstation: 'PlayStation' };
/** The platform of a player's account on the game servers, such as "/steam/76561...": "Steam", "Xbox"... */
export const platformOf = name => PLATFORMS[String(name ?? '').split('/')[1]?.toLowerCase()] ?? '';
const isRows = value => Array.isArray(value) && value.every(Array.isArray);

function readCacheData(data) {
  if (Array.isArray(data)) {
    if (data[0] !== 0) throw new Error('The cache holds an error from the game servers.');
    if (isRows(data[1]) && isRows(data[2])) return { kind: 'challenges', groups: data[1], challenges: data[2] };
    if (isRows(data[1])) {
      const achievementIds = {};
      for (const [id, name] of data[1]) if (whole(id) != null && /^ACHIEVEMENT_[A-Z0-9_]+$/.test(name)) achievementIds[id] = name;
      if (Object.keys(achievementIds).length) return { kind: 'achievementIds', achievementIds };
    }
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.itemDefinitions)) return { kind: 'items', items: itemsOf(data.itemDefinitions) };
    if ('m_challengeProgressEvent.m_info' in data || 'm_GetInventoryItemsEvent.m_info.itemInstances' in data) return readPlayer(data);
  }
  throw new Error('Not one of the game\'s cache files the tracker reads.');
}

/** Badges (1003) and titles (1004), shaped like the servers' item definitions in data/server.json. */
const itemsOf = definitions => list(definitions)
  .filter(d => whole(d?.id) != null && list(d.categoryIDs).some(c => c === 1003 || c === 1004))
  .map(d => ({ id: d.id, name: String(d.name ?? ''), categories: d.categoryIDs, meta: String(d.metaData ?? '') }));

function readPlayer(data) {
  const login = data['m_loginEvent.m_info'];
  const info = login?.defaultProfileInfo ?? login?.accountInfo?.profiles?.[0]?.profileInfo;
  const profileId = whole(data.profileID ?? info?.id);
  const earned = {};
  for (const item of list(data['m_GetInventoryItemsEvent.m_info.itemInstances'])) {
    const id = whole(item?.['itemDefinition.id']);
    const at = whole(item?.creationDate) ?? 0;
    if (id != null && (earned[id] == null || at < earned[id])) earned[id] = at;
  }
  const unlocked = {};
  for (const entry of list(data['m_achievementsEvent.m_info']?.userAchievementsMap)) {
    if (profileId != null && whole(entry?.profileID) !== profileId) continue;
    for (const a of list(entry?.grantedAchievements)) {
      const id = whole(a?.['achievement.id']);
      if (id != null) unlocked[id] = whole(a?.achievedDate) ?? 0;
    }
  }
  const progress = list(data['m_challengeProgressEvent.m_info']?.challengeProgresses)
    .map(p => ({ id: whole(p?.['definition.definitionID']), done: p?.status === 1, count: whole(p?.progress) ?? 0, at: whole(p?.lastCompletedTime) || null }))
    .filter(p => p.id != null);
  return {
    kind: 'cache',
    profileId,
    playerId: String(data.platformAccountID ?? ''),
    alias: String(info?.alias ?? ''),
    platform: platformOf(info?.name ?? login?.accountInfo?.accountName),
    unlocked,
    earned,
    progress,
  };
}

/** The game's public API, which websites can't call (no CORS): the website reads it through its relay. */
const PUBLIC_API = 'https://athens-live-api.worldsedgelink.com/community';

/** The pages of the public profile to open: find a player by in-game name or Steam id, then their badges and achievements. */
export const profileLinks = {
  find: name => (/^\d{17}$/.test(name)
    ? `${PUBLIC_API}/leaderboard/GetPersonalStat?title=athens&profile_names=${encodeURIComponent(JSON.stringify([`/steam/${name}`]))}`
    : `${PUBLIC_API}/leaderboard/GetPersonalStat?title=athens&aliases=${encodeURIComponent(JSON.stringify([name]))}`),
  badges: id => `${PUBLIC_API}/item/getInventoryByProfileIDs?title=athens&profileIDs=${encodeURIComponent(`[${id}]`)}`,
  achievements: id => `${PUBLIC_API}/achievement/getAchievements?title=athens&profileIDs=${encodeURIComponent(`[${id}]`)}`,
};

/** One of those pages through the website's relay (relay/worker.js): the same page at the relay's address. */
export const relayLink = (url, relay) => {
  const page = new URL(url);
  return new URL(page.pathname + page.search, relay).href;
};

/**
 * A page of the public profile the player copied and pasted: whatever the browser added around the JSON is dropped,
 * and the kind is told by its fields. Returns { kind: "profiles", players: [{ id, alias, platform }] },
 * { kind: "badges", id, earned: { itemId: unixSeconds } } or { kind: "achievements", id, unlocked: { achievementId: unixSeconds } }.
 */
export function readPasted(textValue) {
  const text = String(textValue ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No game data in the pasted text.');
  const page = JSON.parse(text.slice(start, end + 1));
  // The servers answer an unknown name (aliases are case-sensitive) with an error code instead of a page.
  if (page?.result?.code !== 0) throw Object.assign(new Error(`The game servers answered ${page?.result?.message ?? 'an error'}.`), { code: 'server' });

  if (Array.isArray(page.statGroups)) {
    const players = page.statGroups.flatMap(g => g?.members ?? []).map(m => ({
      id: whole(m?.profile_id),
      alias: String(m?.alias ?? ''),
      platform: platformOf(m?.name),
    })).filter(p => p.id != null);
    return { kind: 'profiles', players };
  }
  const byProfile = (entries, read) => {
    for (const entry of list(entries)) {
      for (const [key, values] of Object.entries(entry ?? {})) {
        const id = whole(key.replace(/"/g, ''));
        if (id != null && Array.isArray(values)) return { id, ...read(values) };
      }
    }
    return null;
  };
  if ('itemInstancesByProfileID' in page) {
    const found = byProfile(page.itemInstancesByProfileID, items => {
      const earned = {};
      for (const item of items) {
        const id = whole(item?.itemdefinition_id);
        const at = whole(item?.creationdate) ?? 0;
        if (id != null && (earned[id] == null || at < earned[id])) earned[id] = at;
      }
      return { earned };
    });
    return { kind: 'badges', ...(found ?? { id: null, earned: {} }) };
  }
  if ('userAchievementsMap' in page) {
    const found = byProfile(page.userAchievementsMap, achieved => {
      const unlocked = {};
      for (const a of achieved) {
        const id = whole(a?.achievement_id);
        if (id != null) unlocked[id] = whole(a?.achieveddate) ?? 0;
      }
      return { unlocked };
    });
    return { kind: 'achievements', ...(found ?? { id: null, unlocked: {} }) };
  }
  throw new Error('The pasted page isn\'t one of the profile pages.');
}
