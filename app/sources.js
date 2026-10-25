// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// Where the player's data comes from, in both editions: the game's folder and Steam's files (dropped on the website,
// found by the desktop app and read from its /local/ URLs), and pages of the public profile pasted in. files.js
// decodes all of it; the website keeps what it read in this browser.

import { fileKind, parseKeyValues, pickFiles, platformOf, readGameCache, readPasted, readSchema, readStats } from './files.js';

const FILES_KEY = 'aomr-tracker-files';
const PROFILE_KEY = 'aomr-tracker-profile';
/** Folders in a dropped tree that never hold the tracker's files and can be big. */
const SKIP = /^(replays|savegames|screenshots|mods|trigger|logs|bslog|downloadcache|shadercache)$/i;
const MAX_ENTRIES = 20_000;

/** Every kind of file, by its name on the desktop's /local/. */
const LOCAL = {
  cache: 'cache', stats: 'stats', steamUser: 'steam-user', steamSchema: 'steam-schema',
  items: 'items', challenges: 'challenges', achievementIds: 'achievement-ids',
};
export const KINDS = Object.keys(LOCAL);

export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') ?? {};
  } catch {
    return {};
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * What was read. files: per kind, { at, name } and what files.js made of it. profile: the public profile, found or
 * pasted, { id, alias, platform, earned, badgesAt, unlocked, achievementsAt }.
 */
export const data = { files: Object.fromEntries(KINDS.map(kind => [kind, null])), profile: readJson(PROFILE_KEY) };

/** A file's content, decoded; throws when it isn't what its kind says. */
async function decode(kind, buffer) {
  if (kind === 'stats') return readStats(buffer);
  if (kind === 'steamSchema') return { schema: readSchema(parseKeyValues(buffer)) };
  if (kind === 'steamUser') {
    const root = parseKeyValues(buffer);
    if (!root.cache) throw new Error('Not a Steam achievement file.');
    return { root };
  }
  const decoded = await readGameCache(buffer);
  if (decoded.kind !== kind) throw new Error(`Not the game's ${kind} file.`);
  return decoded;
}

const toBase64 = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer;

/** The website: the files read on an earlier visit. */
export async function loadStored() {
  const stored = readJson(FILES_KEY);
  await Promise.all(KINDS.map(async kind => {
    if (!stored[kind]?.data) return;
    try {
      data.files[kind] = { at: stored[kind].at, name: stored[kind].name, ...(await decode(kind, fromBase64(stored[kind].data))) };
    } catch {
      data.files[kind] = null;
    }
  }));
}

/**
 * Reads the files the player dropped or chose, a whole folder's worth or single ones: the right file of each kind,
 * kept for the next visit. Returns the kinds loaded and the names that couldn't be read.
 */
export async function addFiles(files) {
  const stored = readJson(FILES_KEY);
  const result = { loaded: [], failed: [] };
  for (const [kind, file] of Object.entries(pickFiles(files))) {
    try {
      const buffer = await file.arrayBuffer();
      data.files[kind] = { at: file.lastModified, name: file.name, ...(await decode(kind, buffer)) };
      stored[kind] = { at: file.lastModified, name: file.name, data: toBase64(buffer) };
      result.loaded.push(kind);
    } catch {
      result.failed.push(file.name);
    }
  }
  // Too big for this browser's storage: the files still work until the page closes.
  if (result.loaded.length) writeJson(FILES_KEY, stored);
  return result;
}

/**
 * The tracker's files in folders, to a depth of 8 and skipping folders that never hold them. `io` reads one kind of
 * folder: what was dropped (FileSystemEntry) or a folder chosen with the system's dialog (FileSystemHandle).
 */
async function search(roots, io) {
  const found = [];
  let seen = 0;
  const walk = async (entry, depth) => {
    if (++seen > MAX_ENTRIES) return;
    if (io.isFile(entry)) {
      if (fileKind(entry.name)) found.push(await io.file(entry));
      return;
    }
    if (depth > 8 || SKIP.test(entry.name)) return;
    for await (const child of io.children(entry)) await walk(child, depth + 1);
  };
  for (const root of roots) await walk(root, 0);
  return found;
}

/**
 * The tracker's files in what was dropped, searching dropped folders. Must be called while the drop event runs: the
 * browser only hands out the folders then.
 */
export function droppedFiles(transfer) {
  const entries = [...(transfer?.items ?? [])].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const loose = [...(transfer?.files ?? [])];
  if (!entries.length) return Promise.resolve(loose);
  const batchOf = reader => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  return search(entries, {
    isFile: entry => entry.isFile,
    file: entry => new Promise((resolve, reject) => entry.file(resolve, reject)),
    async *children(entry) {
      const reader = entry.createReader();
      for (let batch = await batchOf(reader); batch.length; batch = await batchOf(reader)) yield* batch;
    },
  });
}

/** The tracker's files in a folder chosen with the system's folder dialog (showDirectoryPicker). */
export const folderFiles = folder => search([folder], {
  isFile: handle => handle.kind === 'file',
  file: handle => handle.getFile(),
  children: handle => handle.values(),
});

/** The tracker's files among those of a folder chosen with <input webkitdirectory>, which lists every file in it. */
export const chosenFiles = files => [...files].filter(file =>
  fileKind(file.name) && !(file.webkitRelativePath ?? '').split('/').slice(0, -1).some(folder => SKIP.test(folder)));

/** The desktop: one of the player's files from /local/, for the time the shell reported it was written. */
export async function readLocal(kind, at) {
  if (!(at > 0)) {
    data.files[kind] = null;
    return;
  }
  try {
    const response = await fetch(`local/${LOCAL[kind]}?t=${at}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data.files[kind] = { at, name: LOCAL[kind], ...(await decode(kind, await response.arrayBuffer())) };
  } catch {
    data.files[kind] = null;
  }
}

/**
 * A page of the public profile the player pasted: who they are (the player named `wanted`, or the first one), their
 * badges or their achievements. Returns { ok, message, values } for the page to say.
 */
export function addPasted(text, wanted = '') {
  let page;
  try {
    page = readPasted(text);
  } catch (e) {
    return { ok: false, message: e.code === 'server' ? 'error.no-player' : 'profile.notPage' };
  }
  if (page.kind === 'profiles') {
    const player = page.players.find(p => p.alias.toLowerCase() === wanted.trim().toLowerCase()) ?? page.players[0];
    if (!player) return { ok: false, message: 'error.no-player' };
    if (data.profile.id !== player.id) data.profile = {};
    Object.assign(data.profile, { id: player.id, alias: player.alias, platform: player.platform });
    writeJson(PROFILE_KEY, data.profile);
    return { ok: true, message: 'profile.found', values: [player.alias] };
  }
  if (data.profile.id != null && page.id != null && page.id !== data.profile.id) return { ok: false, message: 'profile.other' };
  data.profile.id ??= page.id;
  const badges = page.kind === 'badges';
  if (badges) Object.assign(data.profile, { earned: page.earned, badgesAt: Date.now() });
  else Object.assign(data.profile, { unlocked: page.unlocked, achievementsAt: Date.now() });
  writeJson(PROFILE_KEY, data.profile);
  return { ok: true, message: badges ? 'profile.gotBadges' : 'profile.gotAchievements', values: [Object.keys(badges ? page.earned : page.unlocked).length] };
}

/** The desktop: a public profile the shell read from the game servers by itself, kept like pasted pages. */
export function setProfile({ id, alias, account, earned, unlocked }) {
  const at = Date.now();
  data.profile = { id, alias, platform: platformOf(account), earned, badgesAt: at, unlocked, achievementsAt: at };
  writeJson(PROFILE_KEY, data.profile);
}

/** Forgets the pasted profile and, on the website, the files kept in this browser. */
export function forget({ files = true } = {}) {
  localStorage.removeItem(PROFILE_KEY);
  data.profile = {};
  if (!files) return;
  localStorage.removeItem(FILES_KEY);
  for (const kind of KINDS) data.files[kind] = null;
}

// ---- A copy of the player's progress, to move it to another browser or device, or to keep ----------------------

/** The player's own files; the lists of the game's badges and achievements come with the site. */
const COPY_KINDS = ['cache', 'stats', 'steamUser'];
export const COPY_MAX = 4 * 1024 * 1024;
const MARK_KEYS = {
  achievements: v => typeof v === 'string' && /^ACHIEVEMENT_[A-Z0-9_]{1,80}$/.test(v),
  checks: v => typeof v === 'string' && /^ACHIEVEMENT_[A-Z0-9_]{1,80}:[A-Za-z0-9_.-]{1,80}$/.test(v),
  badges: v => Number.isSafeInteger(v) && v >= 0,
  reqs: v => Number.isSafeInteger(v) && v >= 0,
};

/** A file's bytes in base64: as this browser kept them, or on the desktop, as the shell serves them. */
async function bytesOf(kind) {
  const kept = readJson(FILES_KEY)[kind]?.data;
  if (kept) return kept;
  try {
    const response = await fetch(`local/${LOCAL[kind]}?t=${data.files[kind].at}`);
    return response.ok ? toBase64(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Everything the tracker knows about the player: their files as they were read, the public profile and the marks. */
export async function makeCopy(marks) {
  const files = {};
  for (const kind of COPY_KINDS) {
    const bytes = data.files[kind] ? await bytesOf(kind) : null;
    if (bytes) files[kind] = { at: data.files[kind].at, name: data.files[kind].name, data: bytes };
  }
  return { app: 'aomr-tracker', version: 1, saved: new Date().toISOString(), files, profile: data.profile, marks };
}

const whole = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const times = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
  .filter(([key, at]) => /^\d{1,15}$/.test(key) && whole(at) != null));

/** A copy from makeCopy, checked and decoded the way dropped files are. Throws for anything else. */
export async function readCopy(text) {
  if (text.length > COPY_MAX) throw new Error('Too big for a copy.');
  const copy = JSON.parse(text);
  if (copy?.app !== 'aomr-tracker' || copy.version !== 1) throw new Error('Not a copy of this tracker.');
  const files = {};
  for (const kind of COPY_KINDS) {
    const file = copy.files?.[kind];
    if (!file) continue;
    const bytes = String(file.data);
    files[kind] = { at: whole(file.at) ?? 0, name: String(file.name ?? '').slice(0, 200), data: bytes, ...(await decode(kind, fromBase64(bytes))) };
  }
  const p = copy.profile ?? {};
  const profile = whole(p.id) == null ? {} : {
    id: p.id,
    alias: String(p.alias ?? '').slice(0, 100),
    platform: String(p.platform ?? '').slice(0, 30),
    ...(p.earned ? { earned: times(p.earned), badgesAt: whole(p.badgesAt) ?? 0 } : {}),
    ...(p.unlocked ? { unlocked: times(p.unlocked), achievementsAt: whole(p.achievementsAt) ?? 0 } : {}),
  };
  const marks = Object.fromEntries(Object.entries(MARK_KEYS).map(([group, valid]) =>
    [group, [...new Set(Array.isArray(copy.marks?.[group]) ? copy.marks[group].filter(valid) : [])]]));
  return { saved: Date.parse(copy.saved) || 0, files, profile, marks };
}

/** Puts a copy's public profile in place of this one's and, on the website, its files too. */
export function applyCopy(copy, { files = true } = {}) {
  data.profile = copy.profile;
  writeJson(PROFILE_KEY, data.profile);
  if (!files) return;
  const stored = readJson(FILES_KEY);
  for (const kind of COPY_KINDS) {
    const { data: bytes, ...file } = copy.files[kind] ?? {};
    data.files[kind] = bytes ? file : null;
    if (bytes) stored[kind] = { at: file.at, name: file.name, data: bytes };
    else delete stored[kind];
  }
  writeJson(FILES_KEY, stored);
}
