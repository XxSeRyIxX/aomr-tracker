import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STRINGS, errorText, formatAgo, langForGame, setLang, t } from '../app/i18n.js';

test('both languages have exactly the same texts, so nothing falls back to the other language', () => {
  const en = Object.keys(STRINGS.en).sort();
  const es = Object.keys(STRINGS.es).sort();
  assert.deepEqual(es, en);
  for (const key of en) {
    const holes = text => (text.match(/\{\d+\}/g) ?? []).sort().join();
    assert.equal(holes(STRINGS.es[key]), holes(STRINGS.en[key]), `${key} must fill the same values in both languages.`);
  }
});

test('every text the page and the shell ask for exists, and none is left over', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const html = read('../app/index.html');
  const js = ['../app/app.js', '../app/sources.js'].map(read).join('\n');
  const used = new Set([
    ...[...html.matchAll(/data-i18n(?:-placeholder|-label|-title)?="([^"]+)"/g)].map(m => m[1]),
    // Every quoted key in the scripts, however it reaches t(): directly, through a choice, or as a message to show.
    ...[...js.matchAll(new RegExp(`'((?:${Object.keys(STRINGS.en).map(k => k.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i).join('|')})\\.[A-Za-z.-]+)'`, 'g'))].map(m => m[1]),
    // Keys the page builds while it runs.
    ...['cache', 'stats', 'steamUser', 'steamSchema'].flatMap(kind => [`files.${kind}`, `files.${kind}What`]),
    ...['windows', 'linux', 'mac'].map(os => `folder.open.${os}`),
    ...['linux', 'mac'].map(os => `folder.where.${os}`),
    ...['story', 'gauntlet', 'arena', 'matches'].map(category => `category.${category}`),
  ]);
  for (const key of used) assert.ok(STRINGS.en[key], `Missing text: ${key}`);
  const unused = Object.keys(STRINGS.en).filter(key => !used.has(key) && !key.startsWith('error.'));
  assert.deepEqual(unused, [], 'Texts nothing uses.');

  const shell = ['Errors.cs', 'Tracker.cs', 'RelicLink.cs', 'Desktop.cs', 'Commands.cs']
    .map(f => read(`../shell/${f}`)).join('\n');
  const codes = new Set([...shell.matchAll(/(?:ApiException\(\d+, |Code: |\(\d+, )"([a-z-]+)"/g)].map(m => m[1]));
  assert.ok(codes.size > 8);
  for (const code of codes) assert.ok(STRINGS.en[`error.${code}`], `The shell's error code ${code} has no text.`);
});

test('language, errors and times', () => {
  assert.equal(langForGame('spanish'), 'es');
  assert.equal(langForGame('latam'), 'es');
  assert.equal(langForGame('german'), 'en');
  setLang('es');
  assert.equal(t('badge.gods', 1, 3), '1 de 3 dioses');
  assert.equal(errorText({ code: 'not-game-folder', message: 'x' }), STRINGS.es['error.not-game-folder']);
  assert.equal(errorText({ code: 'nope', message: 'Disk full' }), 'Algo salió mal: Disk full');
  assert.equal(formatAgo(Date.now() - 3 * 60 * 1000), 'hace 3 minutos');
  setLang('xx');
  assert.equal(t('tab.badges'), 'Badges', 'Unknown languages fall back to English.');
});
