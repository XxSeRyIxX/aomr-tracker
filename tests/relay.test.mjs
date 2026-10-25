import assert from 'node:assert/strict';
import { test } from 'node:test';
import relay from '../relay/worker.js';

const env = { SITE: 'https://xxseryixx.github.io' };
const API = 'https://athens-live-api.worldsedgelink.com';
const FIND = '/community/leaderboard/GetPersonalStat?title=athens&aliases=%5B%22XxSeRyIxX%22%5D';

/** Asks the relay, with the game's servers faked: what it answered, and what it asked them. */
async function ask(path, { origin = env.SITE, method = 'GET', servers } = {}) {
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    asked.push(String(url));
    return servers ? servers() : new Response('{"result":{"code":0}}', { headers: { 'Content-Type': 'application/json;charset=utf-8' } });
  };
  try {
    const request = new Request(`https://relay.example${path}`, { method, headers: origin ? { Origin: origin } : {} });
    return { response: await relay.fetch(request, env), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('the relay reads the three profile pages for the website', async () => {
  const pages = [
    FIND,
    '/community/item/getInventoryByProfileIDs?title=athens&profileIDs=%5B1077381382%5D',
    '/community/achievement/getAchievements?title=athens&profileIDs=%5B1077381382%5D',
  ];
  for (const path of pages) {
    const { response, asked } = await ask(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.SITE);
    assert.equal(response.headers.get('Content-Type'), 'application/json;charset=utf-8');
    assert.equal(await response.text(), '{"result":{"code":0}}');
    assert.deepEqual(asked, [API + path]);
  }
  const local = await ask(FIND, { origin: 'http://127.0.0.1:8082' });
  assert.equal(local.response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8082', 'Pages on the same computer, for testing.');
});

test('the relay reads nothing else, and for no other website', async () => {
  for (const origin of ['https://example.com', 'https://xxseryixx.github.io.example.com', 'http://127.0.0.1.example.com', 'null', '']) {
    const { response, asked } = await ask(FIND, { origin });
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(asked.length, 0);
  }
  const elsewhere = [
    '/',
    '/community/leaderboard/getLeaderBoard2?title=athens',
    '//example.com/community/leaderboard/GetPersonalStat',
    '/community/leaderboard/GetPersonalStat/../../../x',
  ];
  for (const path of elsewhere) {
    const { response, asked } = await ask(path);
    assert.equal(response.status, 404, path);
    assert.equal(asked.length, 0);
  }
  const post = await ask(FIND, { method: 'POST' });
  assert.equal(post.response.status, 404);
  assert.equal(post.asked.length, 0);
});

test('when the game\'s servers fail, the website is told', async () => {
  const busy = await ask(FIND, { servers: () => new Response('busy', { status: 503 }) });
  assert.equal(busy.response.status, 503);
  assert.equal(busy.response.headers.get('Access-Control-Allow-Origin'), env.SITE);
  const down = await ask(FIND, { servers: () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.response.status, 502);
  assert.equal(down.response.headers.get('Access-Control-Allow-Origin'), env.SITE);
});
