import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridge } from '../app/native.js';

function connection(failSend = () => false) {
  let receive;
  const sent = [];
  const ask = createBridge({
    receiveMessage: callback => { receive = callback; },
    sendMessage: raw => {
      if (failSend()) throw new Error('send failed');
      sent.push(JSON.parse(raw));
    },
  });
  return { ask, sent, reply: message => receive(JSON.stringify(message)), raw: text => receive(text) };
}

test('replies settle their own requests, in any order', async () => {
  const shell = connection();
  const first = shell.ask('load', { lang: 'en' });
  const second = shell.ask('stamp');
  assert.deepEqual(shell.sent.map(m => [m.cmd, m.args]), [['load', { lang: 'en' }], ['stamp', {}]]);
  assert.notEqual(shell.sent[0].id, shell.sent[1].id);
  shell.reply({ id: shell.sent[1].id, ok: true, data: { stats: 1 } });
  shell.reply({ id: shell.sent[0].id, ok: true, data: { achievements: [] } });
  assert.deepEqual(await second, { stats: 1 });
  assert.deepEqual(await first, { achievements: [] });
});

test('errors keep their status and code, so the page can say it in its language', async () => {
  const shell = connection();
  const request = shell.ask('choose', { title: 'Choose' });
  shell.reply({ id: shell.sent[0].id, ok: false, status: 400, code: 'not-game-folder', error: 'That folder doesn\'t hold the game\'s files.' });
  await assert.rejects(request, e => e.status === 400 && e.code === 'not-game-folder' && e.message === 'That folder doesn\'t hold the game\'s files.');
});

test('stopping a request rejects it as aborted and asks the shell to cancel it', async () => {
  const shell = connection();
  const stop = new AbortController();
  const request = shell.ask('refresh', {}, stop.signal);
  stop.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.deepEqual(shell.sent[1], { id: shell.sent[1].id, cmd: 'cancel', args: { id: shell.sent[0].id } });
  shell.reply({ id: shell.sent[0].id, ok: true, data: 'too late' });

  await assert.rejects(shell.ask('stamp', {}, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(shell.sent.length, 2, 'An already stopped request is never sent.');
});

test('failed sends, malformed replies and unknown ids leave the bridge usable', async () => {
  let failing = true;
  const shell = connection(() => failing);
  await assert.rejects(shell.ask('open', { url: 'https://example.com/' }), /send failed/);
  failing = false;
  const next = shell.ask('stamp');
  shell.raw('not json');
  shell.reply({ id: 'another-page-1', ok: true, data: 'not for us' });
  shell.reply({ id: shell.sent[0].id, ok: true });
  assert.equal(await next, null);
});
