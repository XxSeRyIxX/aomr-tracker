// AoM Retold Tracker, Copyright (C) 2026 XxSeRyIxX. SPDX-License-Identifier: AGPL-3.0-or-later
// Additional terms under AGPL section 7 apply: see NOTICE.

// The page, the same in both editions. It knows the game from data/ and art/ (tools/export, tools/server-data.mjs)
// and the player from sources.js: the game's folder, Steam's files and the public profile. The desktop app finds the
// files by itself and watches them; the website reads the folder the player drops on it. Without any of it, manual
// mode marks progress by hand. Every text from a file, the game or a server goes in with textContent, never as markup.

import { NATIVE, shell } from './native.js';
import { parseKeyValues, profileLinks, readSchema, readUnlocks, relayLink } from './files.js';
import {
  buildAchievements, buildBadges, closest, completeSchema, mergeDefinitions, mergeEarned, mergeUnlocks, steamTextLanguage,
  summary, unlocksByName, viewAchievements, viewBadges,
} from './core.js';
import { errorText, formatAgo, formatDate, formatNumber, lang, langForBrowser, langForGame, setLang, t } from './i18n.js';
import { COPY_MAX, KINDS, addFiles, addPasted, applyCopy, chosenFiles, data, droppedFiles, folderFiles, forget, loadStored, makeCopy, readCopy, readJson, readLocal, setProfile, writeJson } from './sources.js';

const $ = id => document.getElementById(id);
const PREFS_KEY = 'aomr-tracker';
const POLL_MS = 5000;
const PUBLIC_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Where the game keeps its folder (in "games") and Steam its files, on each system: the progress dialog shows them to
 * copy. The website shows the folder that holds the game's, where the player can drag that one from.
 */
const GAME_FOLDER = 'Age of Mythology Retold';
const FOLDERS = {
  windows: {
    games: '%USERPROFILE%\\Games',
    steam: 'C:\\Program Files (x86)\\Steam\\appcache\\stats',
  },
  linux: {
    games: '~/.local/share/Steam/steamapps/compatdata/1934680/pfx/drive_c/users/steamuser/Games',
    steam: '~/.local/share/Steam/appcache/stats',
  },
  mac: {
    games: '~/Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/Games',
    steam: '~/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/appcache/stats',
  },
};

const prefs = {
  lang: null,
  os: null,
  ach: { state: 'all', category: 'all', sort: 'closest' },
  badge: { state: 'all', sort: 'game' },
  secrets: false,
  manual: false,
  ...readJson(PREFS_KEY),
};
prefs.marks = { achievements: [], checks: [], badges: [], reqs: [], ...prefs.marks };
const query = { ach: '', badge: '' };
const revealed = new Set();
let refreshing = false;
let game = null;
let server = null;
let bundledSchema = [];
// The art of each kind: idle, loading, ready (with its pack and index) or failed, which isn't tried again.
const art = { achievements: { state: 'idle' }, badges: { state: 'idle' } };
const artUrls = new Map();
let live = null;
let stamp = null;
let achievements = [];
let badges = [];
let tab = 'achievements';
let detail = null;
let finding = false;
// The website's relay (config.json, written when the site is published); without one, or once it fails, the player
// opens and copies the profile pages.
let relayUrl = '';
// The website reads a copied profile page by itself once the player opened one, and each copy only once.
let awaitingCopy = false;
let lastCopied = '';

const savePrefs = () => writeJson(PREFS_KEY, prefs);

/** The system this page runs on, for the folders to show: the desktop app says; a browser is told by its user agent. */
function systemOf() {
  if (live?.os) return live.os;
  const platform = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  if (/mac/i.test(platform)) return 'mac';
  if (/win/i.test(platform)) return 'windows';
  return /linux|x11|cros/i.test(platform) ? 'linux' : 'windows';
}

/** Creates an element: h('p', { class: 'x', text: 'hi' }, child...). Text is always set as text. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = value;
    else if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter(c => c != null && c !== false));
  return el;
}

function icon(path) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  el.append(p);
  return el;
}
const CHECK = 'M5 12.5 10 17 19 7';
const LOCK = 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z';

// ---- Data -----------------------------------------------------------------------------------------------------

/** What both editions ship about the game: its texts, what the servers say, and Steam's achievement list. */
async function loadBundle() {
  const get = (path, as) => fetch(path).then(r => (r.ok ? r[as]() : null)).catch(() => null);
  const [texts, servers, schema] = await Promise.all([get('data/game.json', 'json'), get('data/server.json', 'json'), get('data/steam-schema.vdf', 'arrayBuffer')]);
  game = texts;
  server = servers;
  try {
    bundledSchema = schema ? readSchema(parseKeyValues(schema)) : [];
  } catch {
    bundledSchema = [];
  }
}

/** The art of achievements or badges: one archive and its index each, fetched once, the first time they show. */
function ensureArt(kind) {
  const entry = art[kind];
  if (entry.state !== 'idle') return;
  entry.state = 'loading';
  Promise.all([
    fetch(`art/${kind}.json`).then(r => (r.ok ? r.json() : null)),
    fetch(`art/${kind}.pack`).then(r => (r.ok ? r.blob() : null)),
  ]).then(([index, pack]) => {
    if (!index?.at || !pack) throw new Error(`No ${kind} art.`);
    Object.assign(entry, { state: 'ready', at: index.at, pack });
  }).catch(() => {
    entry.state = 'failed';
  }).finally(() => {
    if (kind === 'badges') renderBadges();
    else renderAchievements();
    if (detail) refreshDetail();
  });
}

/**
 * Where the picture of an achievement or badge can come from, best first: the game's art the app ships, the desktop's
 * copy of the game's own for anything newer, then Steam's icon. Null while the art is still on its way.
 */
function artSources(kind, name, steamIcon = '') {
  const entry = art[kind];
  if (entry.state === 'idle' || entry.state === 'loading') return null;
  const at = name && entry.at?.[name];
  if (at) {
    const key = `${kind}/${name}`;
    let url = artUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(entry.pack.slice(at[0], at[0] + at[1], 'image/png'));
      artUrls.set(key, url);
    }
    return [url];
  }
  const drawn = name && NATIVE && live?.game.images ? `media/${kind === 'badges' ? 'badge' : 'achievement'}/${name}.png` : null;
  return [drawn, steamIcon].filter(Boolean);
}

/** The desktop: what it found, then the player's files from /local/. */
async function loadDesktop() {
  live = await shell('load', { lang: prefs.lang ?? (live ? lang() : 'auto') });
  setLang(prefs.lang ?? langForGame(live.game.language));
  stamp = live.files;
  await Promise.all(KINDS.map(kind => readLocal(kind, stamp[kind])));
}

const markSets = () => Object.fromEntries(Object.entries(prefs.marks).map(([group, list]) => [group, new Set(list)]));

/** Steam's own unlocks, when its file is there and is this game's. */
function steamUnlocks(schema) {
  try {
    return data.files.steamUser ? readUnlocks(data.files.steamUser.root, schema) : null;
  } catch {
    return null;
  }
}

/**
 * Everything the page shows, from every source at once: the lists of what the site ships, the game's cache and the
 * desktop's refresh; achievements and items from Steam, the game's cache, the public profile and the refresh, each
 * with its earliest time; badge progress from the game's cache; counters from its statistics.
 */
function build() {
  const { files, profile } = data;
  const online = live?.online;
  const lists = mergeDefinitions(server, files.items, files.challenges, files.achievementIds, online);
  const base = files.steamSchema?.schema.length >= bundledSchema.length ? files.steamSchema.schema : bundledSchema;
  const schema = completeSchema(base, { steam: server?.steam, achievementIds: lists.achievementIds, rarity: lists.rarity });
  const ids = lists.achievementIds;
  const strings = { ...(game?.strings?.[lang()] ?? {}), ...(live?.strings ?? {}) };
  const stats = files.stats?.values ?? null;
  const marks = markSets();
  achievements = buildAchievements({
    schema,
    textLang: steamTextLanguage(lang(), live?.game.language),
    unlocks: mergeUnlocks(steamUnlocks(schema), unlocksByName(files.cache?.unlocked, ids), unlocksByName(profile.unlocked, ids), unlocksByName(online?.achievements, ids)),
    stats,
    strings,
    rarity: lists.rarity,
    marks,
  });
  badges = buildBadges({
    ...lists,
    earned: mergeEarned(files.cache?.earned, profile.earned, online?.earned),
    progress: files.cache?.progress ?? null,
    strings,
    stats,
    marks,
  });
}

function rebuild() {
  build();
  translatePage();
  render();
  if (detail) refreshDetail();
}

/** The desktop: the servers' lists, rarity and the public profile, at start when older than half an hour, or on Refresh. */
async function refreshOnline({ force = false } = {}) {
  if (!live || (!force && Date.now() - (live.online?.publicAt ?? 0) < PUBLIC_MAX_AGE_MS)) return;
  refreshing = true;
  renderButtons();
  try {
    live.online = await shell('refresh', { profileId: data.files.cache?.profileId ?? null });
    if (data.profile.id != null) {
      try {
        setProfile(await shell('profile', { id: data.profile.id }));
      } catch {
        // the profile stays as it was read last time
      }
    }
    rebuild();
    if (force) toast(t('refresh.done'));
  } catch (e) {
    // At start, being offline is no news.
    if (force) toast(errorText(e), true);
  } finally {
    refreshing = false;
    renderButtons();
  }
}

/** The desktop: reads again whatever the game or Steam wrote since. */
async function poll() {
  let next;
  try {
    next = await shell('stamp');
  } catch {
    return;
  }
  const changed = KINDS.filter(kind => next[kind] !== stamp?.[kind]);
  stamp = next;
  if (!changed.length) return;
  await Promise.all(changed.map(kind => readLocal(kind, stamp[kind])));
  rebuild();
  if ($('progress').open) renderProgressDialog();
  toast(t('local.updated'));
}

// ---- Rendering ------------------------------------------------------------------------------------------------

function translatePage() {
  document.documentElement.lang = lang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang()));
  $('about-game-data').textContent = game?.build ? t('about.gameData', game.build, game.exported, server?.fetched ?? game.exported) : '';
}

function render() {
  renderBar();
  renderButtons();
  renderAchievements();
  renderBadges();
}

/** Whether anything says what the player has: a file, the pasted profile or the desktop's refresh. */
const haveData = () => !!(data.files.cache || data.files.stats || data.files.steamUser || data.profile.id != null || live?.online?.earned);
const hasMarks = () => Object.values(prefs.marks).some(list => list.length > 0);

/** Manual mode: no progress loaded, and the player chose to mark by hand or already has marks (a copy, say). */
const manualMode = () => !haveData() && (prefs.manual || hasMarks());

function renderBar() {
  const a = summary(achievements, x => x.unlocked);
  const b = summary(badges, x => x.earned);
  $('count-achievements').textContent = achievements.length ? `${a.done}/${a.total}` : '';
  $('count-badges').textContent = badges.length ? `${b.done}/${b.total}` : '';
  for (const name of ['achievements', 'badges']) {
    $(`tab-${name}`).setAttribute('aria-selected', String(tab === name));
    $(`view-${name}`).hidden = tab !== name;
  }

  const { files, profile } = data;
  const name = files.cache?.alias || live?.online?.alias || profile.alias || live?.player?.persona || '';
  const platform = files.cache?.platform || profile.platform || '';
  const known = haveData();
  const manual = manualMode();
  $('player-name').textContent = name ? (platform ? `${name} · ${platform}` : name) : t(known ? 'player.files' : manual ? 'manual.start' : 'player.load');
  $('player').className = `player ${known ? 'ok' : 'todo'}`;
  $('player').title = manual ? t('player.load') : '';

  // Only a first visit has the notice: the two ways in.
  $('notice').hidden = known || manual;
  $('notice-text').textContent = t(NATIVE ? 'notice.desktop' : 'notice.web');
}

function renderButtons() {
  const refresh = $('refresh');
  refresh.disabled = refreshing;
  refresh.classList.toggle('busy', refreshing);
  setPressed('ach-state', prefs.ach.state);
  setPressed('badge-state', prefs.badge.state);
  $('ach-category').value = prefs.ach.category;
  $('ach-sort').value = prefs.ach.sort;
  $('badge-sort').value = prefs.badge.sort;
  $('ach-secrets').checked = prefs.secrets;
}

function setPressed(groupId, value) {
  for (const button of $(groupId).querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.value === value));
}

function progressBar(value, goal, label) {
  const percent = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const fill = h('div', { class: 'bar-fill' });
  fill.style.setProperty('--p', `${percent}%`);
  return h('div', { class: 'bar' },
    h('div', { class: 'bar-label' }, h('span', { text: label ?? `${formatNumber(value)} / ${formatNumber(goal)}` }), h('span', { text: `${Math.floor(percent)}%` })),
    h('div', { class: 'bar-line', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(value) }, fill));
}

const stateLine = (done, text) => h('span', { class: done ? 'state ok' : 'state locked' }, icon(done ? CHECK : LOCK), h('span', { text }));

/** A picture that tries its sources in turn and ends on a star; an empty frame while the art is on its way (null). */
function picture(sources) {
  const box = h('div', { class: 'art' });
  const queue = [...(sources ?? [])];
  const symbol = () => h('span', { class: 'fallback', text: sources ? '★' : '' });
  if (!queue.length) {
    box.append(symbol());
    return box;
  }
  const img = h('img', { src: queue.shift(), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    if (queue.length) img.src = queue.shift();
    else img.replaceWith(symbol());
  });
  box.append(img);
  return box;
}

const pictureOf = (isAch, item) => (isAch ? artSources('achievements', item.art, item.icon) : artSources('badges', item.art));

/** What a card's last line says about an achievement or badge, and whether it is done. */
function achievementStatus(a) {
  if (!a.unlocked) return [false, a.known ? t('ach.lockedState') : null];
  if (a.source === 'mark') return [true, t('ach.marked')];
  if (a.source === 'stats') return [true, t('ach.fromStats')];
  return [true, a.unlockedAt ? t('ach.unlockedOn', formatDate(a.unlockedAt)) : t('ach.unlockedDone')];
}

function badgeStatus(b) {
  if (b.earned) return [true, b.manual ? t('badge.marked') : b.earnedAt ? t('badge.earnedOn', formatDate(b.earnedAt)) : t('badge.earnedDone')];
  if (b.status === 'unknown') return [false, t('badge.unknown')];
  if (b.status === 'none') return [false, t('badge.none')];
  return [false, null];
}

function badgeBar(b) {
  if (b.reqs.length) return progressBar(b.value, b.goal, t('badge.gods', b.value, b.goal));
  if (b.goal > 1 && (b.known || b.streak)) return progressBar(b.value, b.goal, b.streak ? `${t('badge.streak')}: ${formatNumber(b.value)} / ${formatNumber(b.goal)}` : null);
  return null;
}

function card(kind, item) {
  const isAch = kind === 'ach';
  const done = isAch ? item.unlocked : item.earned;
  const started = isAch ? !item.unlocked && item.ratio > 0 : item.status === 'progress';
  const secret = isAch && item.hidden && !item.unlocked && !prefs.secrets && !revealed.has(item.api);
  const [, status] = isAch ? achievementStatus(item) : badgeStatus(item);
  const bar = isAch ? (!item.unlocked && item.progress ? progressBar(item.progress.value, item.progress.goal) : null) : (!item.earned ? badgeBar(item) : null);
  const head = isAch
    ? (item.rarity != null ? h('span', { class: item.rarity < 5 ? 'rarity rare' : 'rarity', text: t('ach.rarityShort', formatNumber(item.rarity)), title: t('ach.rarity', formatNumber(item.rarity)) }) : null)
    : h('span', { class: 'tier', 'aria-label': t('badge.tier', item.tier + 1) }, [0, 1, 2, 3, 4].map(i => h('i', { class: i <= item.tier ? 'on' : null })));
  const text = isAch ? (item.placeholder ? t('ach.placeholder') : item.desc) : item.objective;
  const key = isAch ? item.api : item.id;
  const open = () => openDetail(kind, key);
  const el = h('article', {
    class: `item ${isAch ? 'achievement' : 'badge'}${done ? ' done' : started ? ' progress' : ''}`,
    role: 'button',
    tabindex: '0',
    'aria-label': t('detail.open', item.name),
    onclick: open,
    onkeydown: e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
  },
  picture(pictureOf(isAch, item)),
  h('div', { class: 'item-body' },
    h('div', { class: 'item-head' }, h('h3', { class: 'item-name', text: item.name, title: item.name }), head),
    h('p', { class: secret ? 'item-desc secret' : 'item-desc', text: text || '—' }),
    h('div', { class: 'item-foot' }, bar ?? (status ? stateLine(done, status) : null))));
  // Manual mode: every card is marked by hand with one click. Loading the progress switches it off.
  const label = item.manual ? t('detail.unmark') : t(isAch ? 'detail.markAch' : 'detail.markBadge');
  const mark = manualMode() && (!done || item.manual)
    ? h('button', {
      type: 'button',
      class: 'mark',
      'aria-pressed': String(!!item.manual),
      'aria-label': `${label}: ${item.name}`,
      title: label,
      onclick: () => toggleMark(isAch ? 'achievements' : 'badges', key, kind, key),
    }, icon(CHECK))
    : null;
  return h('div', { class: 'cell', 'data-key': `${kind}:${key}` }, el, mark);
}

function renderAchievements() {
  if (tab === 'achievements' || detail) ensureArt('achievements');
  // Steam hides none of this game's achievements today; the box shows only if it ever does.
  $('ach-secrets-wrap').hidden = !achievements.some(a => a.hidden && !a.unlocked);
  const shown = viewAchievements(achievements, { query: query.ach, ...prefs.ach });
  const next = closest(achievements, a => a.unlocked);
  // Sorted by "closest first", the grid already starts with them.
  const showNext = next.length > 0 && !query.ach && prefs.ach.state !== 'unlocked' && prefs.ach.sort !== 'closest';
  $('ach-next-wrap').hidden = !showNext;
  $('ach-next').replaceChildren(...(showNext ? next.map(a => card('ach', a)) : []));
  $('ach-count').textContent = achievements.length ? t('count.achievements', shown.length, achievements.length) : '';
  $('ach-grid').replaceChildren(...shown.map(a => card('ach', a)));
  const empty = $('ach-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = t('empty.noMatch');
}

function renderBadges() {
  if (tab === 'badges' || detail) ensureArt('badges');
  const shown = viewBadges(badges, { query: query.badge, ...prefs.badge });
  const next = closest(badges, b => b.earned);
  const showNext = next.length > 0 && !query.badge && prefs.badge.state !== 'earned' && prefs.badge.sort !== 'closest';
  $('badge-next-wrap').hidden = !showNext;
  $('badge-next').replaceChildren(...(showNext ? next.map(b => card('badge', b)) : []));
  $('badge-count').textContent = badges.length ? t('count.badges', shown.length, badges.length) : '';
  $('badge-grid').replaceChildren(...shown.map(b => card('badge', b)));
  const empty = $('badge-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = badges.length ? t('empty.noMatch') : t('empty.noBadges');
}

// ---- Details --------------------------------------------------------------------------------------------------

function openDetail(kind, key) {
  detail = { kind, key };
  if (kind === 'ach') revealed.add(key);
  refreshDetail();
  const dialog = $('detail');
  if (!dialog.open) dialog.showModal();
}

/** Fills the details dialog from the current data, so marks show at once. */
function refreshDetail() {
  const isAch = detail.kind === 'ach';
  const item = isAch ? achievements.find(a => a.api === detail.key) : badges.find(b => b.id === detail.key);
  if (!item) return;
  const done = isAch ? item.unlocked : item.earned;
  const [, status] = isAch ? achievementStatus(item) : badgeStatus(item);

  const box = $('detail-art');
  box.className = done ? 'detail-art' : 'detail-art dim';
  box.replaceChildren(picture(pictureOf(isAch, item)));
  $('detail-name').textContent = item.name;
  $('detail-status').textContent = status ?? '';
  $('detail-desc').textContent = (isAch ? (item.placeholder ? t('ach.placeholder') : item.desc) : item.objective) || '—';

  const bar = isAch ? (item.progress && !item.unlocked ? progressBar(item.progress.value, item.progress.goal) : null) : (!item.earned ? badgeBar(item) : null);
  $('detail-progress').replaceChildren(...(bar ? [bar] : []));

  // Anything the data doesn't show as done can be ticked: an entry of a checklist, or a god of an "all gods" badge.
  const list = (isAch ? item.checklist : item.reqs) ?? [];
  const markable = c => !done && (!c.done || c.manual);
  $('detail-list').replaceChildren(...list.map(c => (markable(c)
    ? h('button', {
      type: 'button',
      class: c.done ? 'chip done' : 'chip',
      'aria-pressed': String(c.done),
      text: c.label,
      onclick: () => (isAch ? toggleMark('checks', `${item.api}:${c.key}`, 'ach', item.api) : toggleMark('reqs', c.id, 'badge', item.id)),
    })
    : h('span', { class: c.done ? 'chip done' : 'chip', text: c.label }))));

  const canMark = !done || item.manual;
  const hint = $('detail-hint');
  hint.hidden = !canMark;
  hint.textContent = list.some(markable) ? t('detail.toggleHint') : t('detail.markHint');
  const mark = $('detail-mark');
  mark.hidden = !canMark;
  mark.textContent = item.manual ? t('detail.unmark') : isAch ? t('detail.markAch') : t('detail.markBadge');
  mark.onclick = () => toggleMark(isAch ? 'achievements' : 'badges', detail.key, detail.kind, detail.key);

  const facts = [];
  if (isAch) {
    facts.push([t('detail.category'), t(`category.${item.category}`)]);
    if (item.rarity != null) facts.push([t('detail.rarity'), t('ach.rarity', formatNumber(item.rarity))]);
  } else {
    facts.push([t('detail.tier'), String(item.tier + 1)]);
  }
  $('detail-facts').replaceChildren(...facts.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]));
}

/**
 * Marks or unmarks by hand, kept at once. The item's cards change where they are: the lists are sorted and filtered
 * again only when drawn anew, so nothing moves under the pointer.
 */
function toggleMark(group, markKey, kind, key) {
  const list = prefs.marks[group];
  const at = list.indexOf(markKey);
  if (at >= 0) list.splice(at, 1);
  else list.push(markKey);
  // A mark with nothing loaded starts manual mode, and every card gets its check.
  const starting = !haveData() && !prefs.manual;
  prefs.manual ||= starting;
  savePrefs();
  if (starting) {
    rebuild();
    return;
  }
  build();
  renderBar();
  const item = kind === 'ach' ? achievements.find(a => a.api === key) : badges.find(b => b.id === key);
  for (const cell of item ? document.querySelectorAll(`.cell[data-key="${CSS.escape(`${kind}:${key}`)}"]`) : []) {
    const focused = cell.contains(document.activeElement) && (document.activeElement.classList.contains('mark') ? '.mark' : '.item');
    const fresh = card(kind, item);
    cell.replaceWith(fresh);
    if (focused) fresh.querySelector(focused)?.focus({ preventScroll: true });
  }
  if (detail) refreshDetail();
}

/** Manual mode, chosen instead of loading the progress. The choice is kept for the next visits. */
function startManual() {
  prefs.manual = true;
  savePrefs();
  if ($('progress').open) $('progress').close();
  render();
  toast(t('manual.text'));
}

// ---- Progress dialog: the game's folder, Steam's files and the public profile ---------------------------------

function openProgressDialog() {
  const steamId = /^\d{17}$/.test(data.files.stats?.playerId ?? '') ? data.files.stats.playerId : '';
  if (!$('profile-name').value) $('profile-name').value = data.profile.alias ?? data.files.cache?.alias ?? steamId;
  renderProgressDialog();
  if (!$('progress').open) $('progress').showModal();
}

function setLink(id, url) {
  const link = $(id);
  if (url) link.href = url;
  else link.removeAttribute('href');
  link.setAttribute('aria-disabled', String(!url));
}

function fileRow(kind) {
  const file = data.files[kind];
  const state = file ? t(NATIVE ? 'files.found' : 'files.loaded', formatAgo(file.at)) : t(NATIVE ? 'files.missing' : 'files.notLoaded');
  return h('li', {},
    h('div', { class: 'file-row' }, h('b', { text: t(`files.${kind}`) }), h('span', { class: file ? 'file-state ok' : 'file-state', text: state })),
    h('span', { class: 'muted small', text: t(`files.${kind}What`) }));
}

function renderProgressDialog() {
  const os = prefs.os ?? systemOf();
  setPressed('os-tabs', os);
  const { games, steam } = FOLDERS[os];
  $('folder-path').textContent = NATIVE ? `${games}${os === 'windows' ? '\\' : '/'}${GAME_FOLDER}` : games;
  $('steam-path').textContent = steam;
  $('folder-hint').textContent = [t(`folder.open.${os}`), NATIVE ? '' : t('folder.drag'), os === 'windows' ? '' : t(`folder.where.${os}`)]
    .filter(Boolean).join(' ');
  if (NATIVE) {
    const found = $('folder-found');
    found.textContent = live?.folder ? t('folder.found', live.folder) : t('folder.notFound');
    found.className = live?.folder ? 'file-state ok' : 'file-state';
  }
  $('file-list').replaceChildren(fileRow('cache'), fileRow('stats'));
  $('steam-list').replaceChildren(fileRow('steamUser'), fileRow('steamSchema'));

  const { profile } = data;
  const name = $('profile-name').value.trim();
  setLink('link-find', name ? profileLinks.find(name) : null);
  setLink('link-badges', profile.id != null ? profileLinks.badges(profile.id) : null);
  setLink('link-achievements', profile.id != null ? profileLinks.achievements(profile.id) : null);
  $('find-profile').disabled = finding || !name;
  const stateOf = (id, ok, text) => {
    $(id).textContent = text;
    $(id).className = ok ? 'step-state ok' : 'step-state';
  };
  const who = profile.platform ? `${profile.alias} · ${profile.platform}` : profile.alias;
  // Names are matched as written, so until the player is found, the line under the name says so.
  const found = profile.id == null ? t('profile.exact') : automatic()
    ? `${t('profile.found', who)} · ${t('profile.summary', Object.keys(profile.earned ?? {}).length, Object.keys(profile.unlocked ?? {}).length, formatAgo(profile.badgesAt))}`
    : t('profile.found', who);
  stateOf('state-find', profile.id != null, found);
  stateOf('state-badges', !!profile.badgesAt, profile.badgesAt ? t('profile.badgesAgo', Object.keys(profile.earned ?? {}).length, formatAgo(profile.badgesAt)) : t('profile.notYet'));
  stateOf('state-achievements', !!profile.achievementsAt, profile.achievementsAt ? t('profile.achievementsAgo', Object.keys(profile.unlocked ?? {}).length, formatAgo(profile.achievementsAt)) : t('profile.notYet'));

  // The desktop finds the files itself, so only a pasted profile is left to forget there.
  const forgetButton = $('forget');
  forgetButton.textContent = t(NATIVE ? 'progress.forgetProfile' : 'progress.forget');
  forgetButton.hidden = NATIVE && profile.id == null;
  $('progress-manual').hidden = haveData() || manualMode();
}

/** Reads dropped or chosen files and says what came of it. */
async function importFiles(pending) {
  const result = await addFiles(await pending);
  if (!result.loaded.length) {
    toast(result.failed.length ? t('files.damaged', result.failed.join(', ')) : t('files.none'), true);
    return;
  }
  rebuild();
  if ($('progress').open) renderProgressDialog();
  if (result.failed.length) toast(t('files.damaged', result.failed.join(', ')), true);
  else toast(t('files.done'));
}

function paste(text, quiet = false) {
  const result = addPasted(text, $('profile-name').value);
  // Something else copied, read by itself from the clipboard, is none of the tracker's business.
  if (quiet && result.message === 'profile.notPage') return;
  toast(t(result.message, ...(result.values ?? [])), !result.ok);
  if (!result.ok) return;
  rebuild();
  renderProgressDialog();
}

/**
 * The website, after the player opened a profile page: reads what they copied there when they come back, where the
 * browser lets pages read the clipboard (Chrome and Edge ask once). Elsewhere the box takes it.
 */
async function readCopied() {
  if (!awaitingCopy || !$('progress').open || !navigator.clipboard?.readText) return;
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text.trim() || text === lastCopied) return;
  lastCopied = text;
  paste(text, true);
}

/** Whether the tracker reads public profiles by itself: the desktop always, the website through the relay. */
const automatic = () => !document.documentElement.classList.contains('profile-by-hand');

/** The website: the three public pages of a player's profile, read through the relay instead of copied. */
async function readThroughRelay(name) {
  const read = async url => {
    // Some Spanish ISPs block Cloudflare's addresses during football matches, and then connections just hang.
    const response = await fetch(relayLink(url, relayUrl), { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const text = response?.ok ? await response.text().catch(() => null) : null;
    if (text == null) throw Object.assign(new Error('The relay failed.'), { relay: true, status: response?.status ?? 0 });
    return text;
  };
  const found = addPasted(await read(profileLinks.find(name)), name);
  if (!found.ok) return found;
  for (const url of [profileLinks.badges(data.profile.id), profileLinks.achievements(data.profile.id)]) {
    const page = addPasted(await read(url));
    if (!page.ok) return page;
  }
  return found;
}

/**
 * Finds the player on the game servers and reads their badges and achievements, with no pages to copy: the desktop
 * asks the servers itself, the website through the relay. When the relay fails, the website shows the steps by hand.
 */
async function findProfile() {
  const name = $('profile-name').value.trim();
  if (!name || finding) return;
  finding = true;
  renderProgressDialog();
  try {
    if (NATIVE) {
      setProfile(await shell('profile', { name }));
    } else {
      const result = await readThroughRelay(name);
      if (!result.ok) {
        toast(t(result.message, ...(result.values ?? [])), true);
        return;
      }
    }
    $('profile-name').value = data.profile.alias || name;
    rebuild();
    toast(t('profile.found', data.profile.platform ? `${data.profile.alias} · ${data.profile.platform}` : data.profile.alias));
  } catch (e) {
    if (!e.relay) {
      toast(errorText(e), true);
      return;
    }
    document.documentElement.classList.add('profile-by-hand');
    toast(t(e.status === 429 ? 'profile.relayUsedUp' : 'profile.relayFailed'), true);
  } finally {
    finding = false;
    renderProgressDialog();
  }
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast(t('folder.copied')), () => {});
}

/** Everything the tracker knows about the player in one file, to load in another browser or device, or to keep. */
async function saveCopy() {
  const progress = await makeCopy(prefs.marks);
  const link = h('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(progress)], { type: 'application/json' })),
    download: `aomr-tracker-${progress.saved.slice(0, 10)}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** A copy saved here or elsewhere. The desktop takes its marks and profile: the app reads the game's files itself. */
async function loadCopy(file) {
  let progress;
  try {
    if (file.size > COPY_MAX) throw new Error('Too big.');
    progress = await readCopy(await file.text());
  } catch {
    toast(t('copy.bad'), true);
    return;
  }
  if ((haveData() || hasMarks()) && !window.confirm(t('copy.replace'))) return;
  applyCopy(progress, { files: !NATIVE });
  prefs.marks = progress.marks;
  savePrefs();
  rebuild();
  if ($('progress').open) renderProgressDialog();
  toast(t('copy.loaded', formatDate(Math.floor(progress.saved / 1000))));
}

// ---- Messages -------------------------------------------------------------------------------------------------

let toastTimer = 0;
/** A short message, shown in the top layer so it stays above an open dialog. */
function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidePopover(), error ? 7000 : 3500);
}

// ---- Wiring ---------------------------------------------------------------------------------------------------

/** A click outside a dialog closes it, as Escape does; a drag that only ends outside, selecting text, doesn't. */
function closeOutside(dialog) {
  const outside = e => {
    const box = dialog.getBoundingClientRect();
    return e.target === dialog && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', e => { pressedOutside = outside(e); });
  dialog.addEventListener('click', e => {
    if (pressedOutside && outside(e)) dialog.close();
    pressedOutside = false;
  });
  // Not every embedded web view delivers the native Escape.
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    dialog.close();
  });
}

const tabFromHash = () => (location.hash === '#badges' ? 'badges' : 'achievements');

function wire() {
  window.addEventListener('hashchange', () => {
    tab = tabFromHash();
    renderBar();
    ensureArt(tab);
    window.scrollTo({ top: 0 });
  });
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', async () => {
      if (button.dataset.lang === lang()) return;
      prefs.lang = setLang(button.dataset.lang);
      savePrefs();
      if (NATIVE) await loadDesktop().catch(e => toast(errorText(e), true));
      rebuild();
      if ($('progress').open) renderProgressDialog();
    });
  }
  $('refresh').addEventListener('click', async () => {
    await loadDesktop().catch(e => toast(errorText(e), true));
    rebuild();
    await refreshOnline({ force: true });
  });
  $('player').addEventListener('click', openProgressDialog);
  $('notice-load').addEventListener('click', openProgressDialog);
  $('notice-manual').addEventListener('click', startManual);
  $('progress-manual').addEventListener('click', startManual);
  $('copy-save').addEventListener('click', () => saveCopy().catch(e => toast(errorText(e), true)));
  $('copy-load').addEventListener('click', () => $('copy-file').click());
  $('copy-file').addEventListener('change', e => {
    if (e.target.files[0]) loadCopy(e.target.files[0]);
    e.target.value = '';
  });

  const segmented = (id, group, render) => {
    $(id).addEventListener('click', e => {
      const button = e.target.closest('button[data-value]');
      if (!button) return;
      prefs[group].state = button.dataset.value;
      savePrefs();
      renderButtons();
      render();
    });
  };
  segmented('ach-state', 'ach', renderAchievements);
  segmented('badge-state', 'badge', renderBadges);
  $('ach-category').addEventListener('change', e => { prefs.ach.category = e.target.value; savePrefs(); renderAchievements(); });
  $('ach-sort').addEventListener('change', e => { prefs.ach.sort = e.target.value; savePrefs(); renderAchievements(); });
  $('badge-sort').addEventListener('change', e => { prefs.badge.sort = e.target.value; savePrefs(); renderBadges(); });
  $('ach-secrets').addEventListener('change', e => { prefs.secrets = e.target.checked; savePrefs(); renderAchievements(); });
  $('ach-search').addEventListener('input', e => { query.ach = e.target.value; renderAchievements(); });
  $('badge-search').addEventListener('input', e => { query.badge = e.target.value; renderBadges(); });
  $('detail').addEventListener('close', () => { detail = null; });

  // The progress dialog.
  $('os-tabs').addEventListener('click', e => {
    const button = e.target.closest('button[data-value]');
    if (!button) return;
    prefs.os = button.dataset.value;
    savePrefs();
    renderProgressDialog();
  });
  $('copy-folder').addEventListener('click', () => copyText($('folder-path').textContent));
  $('copy-steam').addEventListener('click', () => copyText($('steam-path').textContent));
  // Clicking the box chooses the folder itself: with the system's folder dialog where the browser offers it to pages,
  // else with the folder input, which lists every file in the folder.
  $('folder-input').addEventListener('click', e => {
    if (typeof window.showDirectoryPicker !== 'function') return;
    e.preventDefault();
    window.showDirectoryPicker({ id: 'game-folder' }).then(
      folder => importFiles(folderFiles(folder)),
      error => { if (error?.name !== 'AbortError') toast(errorText(error), true); });
  });
  $('folder-input').addEventListener('change', e => {
    importFiles(chosenFiles(e.target.files));
    e.target.value = '';
  });
  $('choose-files').addEventListener('click', () => $('file-input').click());
  $('choose-folder').addEventListener('click', async () => {
    try {
      if (!(await shell('choose', { title: t('folder.chooseTitle') }))) return;
      await loadDesktop();
      rebuild();
      renderProgressDialog();
      toast(t('files.done'));
    } catch (e) {
      toast(errorText(e), true);
    }
  });
  $('profile-name').addEventListener('input', renderProgressDialog);
  // Enter finds the player instead of submitting, which would close the dialog.
  $('profile-name').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (automatic()) findProfile();
    else if ($('link-find').hasAttribute('href')) $('link-find').click();
  });
  $('find-profile').addEventListener('click', findProfile);
  // The pasted page is read as it arrives and never stays in the box.
  $('paste').addEventListener('paste', e => {
    e.preventDefault();
    paste(e.clipboardData?.getData('text') ?? '');
  });
  // Read takes what is in the box, or with the box empty what was copied, once the browser lets it.
  $('read-paste').addEventListener('click', async () => {
    const typed = $('paste').value;
    $('paste').value = '';
    if (typed.trim()) {
      paste(typed);
      return;
    }
    try {
      const copied = await navigator.clipboard.readText();
      if (copied.trim()) paste(copied);
    } catch {
      $('paste').focus();
    }
  });
  // A link that isn't ready yet (no profile found) does nothing; one that is starts the wait for its copied page.
  for (const id of ['link-find', 'link-badges', 'link-achievements']) {
    $(id).addEventListener('click', e => {
      if (!$(id).hasAttribute('href')) e.preventDefault();
      else awaitingCopy = true;
    });
  }
  window.addEventListener('focus', readCopied);
  $('progress').addEventListener('close', () => { awaitingCopy = false; });
  $('forget').addEventListener('click', () => {
    forget({ files: !NATIVE });
    rebuild();
    renderProgressDialog();
  });

  // "/" jumps to the search of the open tab.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, dialog')) return;
    e.preventDefault();
    $(tab === 'badges' ? 'badge-search' : 'ach-search').focus();
  });

  for (const button of document.querySelectorAll('[data-about]')) button.addEventListener('click', () => $('about').showModal());
  for (const dialog of document.querySelectorAll('dialog')) closeOutside(dialog);

  // A file dropped on a web view replaces the page; the website reads it instead, the desktop ignores it.
  const hasFiles = e => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = NATIVE ? 'none' : 'copy';
    $('drop').classList.add('over');
  });
  window.addEventListener('dragleave', () => $('drop').classList.remove('over'));
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('drop').classList.remove('over');
    if (NATIVE) return;
    const copy = [...(e.dataTransfer.files ?? [])].find(file => /\.json$/i.test(file.name));
    if (copy) loadCopy(copy);
    else importFiles(droppedFiles(e.dataTransfer));
  });
  $('file-input').addEventListener('change', e => {
    importFiles([...e.target.files]);
    e.target.value = '';
  });

  // The desktop opens web links in the user's browser, never inside the app.
  if (NATIVE) {
    document.addEventListener('click', e => {
      const link = e.target.closest?.('a[href]');
      if (!link || new URL(link.href).origin === location.origin) return;
      e.preventDefault();
      shell('open', { url: link.href }).catch(error => toast(errorText(error), true));
    });
  }
}

/** The website's settings from its publishing (config.json): the relay's address, when the site has one. */
async function loadConfig() {
  try {
    const relay = new URL((await (await fetch('config.json', { cache: 'no-cache' })).json()).relay);
    if (relay.protocol === 'https:') relayUrl = relay.origin;
  } catch {
    // no settings: the player opens and copies the profile pages
  }
}

async function start() {
  document.documentElement.classList.add(NATIVE ? 'desktop' : 'web');
  setLang(prefs.lang ?? langForBrowser(navigator.languages));
  tab = tabFromHash();
  translatePage();
  wire();
  await Promise.all([loadBundle(), NATIVE ? null : loadConfig()]);
  document.documentElement.classList.toggle('profile-by-hand', !NATIVE && !relayUrl);
  if (NATIVE) {
    await loadDesktop().catch(e => toast(errorText(e), true));
  } else {
    await loadStored();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  rebuild();
  document.body.classList.remove('booting');
  if (NATIVE) {
    refreshOnline();
    setInterval(poll, POLL_MS);
  }
}

start();
