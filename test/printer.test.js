// One OctoPrint link: push path, REST fallback, events, reconnection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEventsFromStates, PrinterLink } from '../src/printer.js';
import { fromRest } from '../src/octoprint/model.js';
import { API_KEY, STATES, createOctoPrint, fixture, settle } from './helpers/fakeOctoPrint.js';
import { FAST_SOCKET, FAST_TIMINGS } from './helpers/world.js';

function linkTo(server, options = {}) {
  const link = new PrinterLink({
    slot: 1,
    url: server.url,
    apiKey: API_KEY,
    fetch: server.fetch,
    createSocket: server.createSocket,
    timings: FAST_TIMINGS,
    socketTimings: FAST_SOCKET,
    ...options,
  });
  const events = [];
  link.on('print', (event) => events.push(event));
  return { link, events };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('connects, reads the capabilities, then follows the push link', async (t) => {
  const server = createOctoPrint();
  const { link } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  assert.equal(link.connected, true);
  assert.equal(link.version, '1.11.8');
  assert.deepEqual(link.capabilities.tools, ['tool0']);
  assert.equal(link.push.live, true);
  server.setState('printing');
  await settle();
  assert.equal(link.snapshot.state, 'printing');
  assert.equal(link.snapshot.file, 'benchy-mini.gcode');
  // The socket was authenticated and throttled.
  const [socket] = server.sockets;
  assert.deepEqual(socket.sent[0], { auth: `admin:${server.session}` });
  assert.deepEqual(socket.sent[1], { throttle: 10 });
});

test('OctoPrint events become print events, with duration and reason', async (t) => {
  const server = createOctoPrint({ state: 'printing' });
  const { link, events } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  server.emitEvent('PrintFailed', { name: 'a.gcode', time: 24.5, reason: 'cancelled' });
  server.emitEvent('PrintCancelled', { name: 'a.gcode', time: 24.5 });
  server.emitEvent('PrintDone', { name: 'b.gcode', time: 8.04 });
  server.emitEvent('PrintPaused', { name: 'b.gcode' });
  await settle();
  assert.deepEqual(events, [
    { type: 'failed', file: 'a.gcode', seconds: 24.5, reason: 'cancelled' },
    { type: 'done', file: 'b.gcode', seconds: 8.04, reason: null },
    // No time in PrintPaused: the elapsed time of the job.
    { type: 'paused', file: 'b.gcode', seconds: 5, reason: null },
  ]);
});

test('the recorded push session of a real print gives the expected events', async (t) => {
  const server = createOctoPrint();
  const { link, events } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  const [socket] = server.liveSockets();
  for (const { message } of fixture('push-session.json')) {
    if (message.current || message.event) {
      socket.deliver(message);
    }
  }
  await settle(200);
  assert.deepEqual(
    events.map((e) => [e.type, e.file, e.reason]),
    [
      ['started', 'benchy-mini.gcode', null],
      ['paused', 'benchy-mini.gcode', null],
      ['failed', 'benchy-mini.gcode', 'cancelled'],
      ['started', 'short.gcode', null],
      ['done', 'short.gcode', null],
    ],
  );
  assert.equal(Math.round(events[4].seconds), 8);
  assert.equal(link.snapshot.state, 'operational');
});

test('without WebSocket, the REST API is polled and events derived from the states', async (t) => {
  const server = createOctoPrint({ websocket: false });
  const { link, events } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  assert.equal(link.push.live, false);
  for (const state of ['printing', 'paused', 'printing', 'done', 'printing', 'cancelled']) {
    server.setState(state);
    await wait(80);
  }
  assert.deepEqual(
    events.map((e) => [e.type, e.reason]),
    [
      ['started', null],
      ['paused', null],
      ['done', null],
      ['started', null],
      ['failed', 'cancelled'],
    ],
  );
});

test('derived events: finishing, error and a disconnection mid-print', () => {
  const snap = (name) => fromRest(...STATES[name]());
  const printing = snap('printing');
  assert.deepEqual(deriveEventsFromStates(printing, { ...snap('operational'), progress: null }), [
    { type: 'failed', file: 'benchy-mini.gcode', seconds: 5, reason: 'cancelled' },
  ]);
  assert.deepEqual(
    deriveEventsFromStates({ ...printing, state: 'finishing' }, snap('operational')).map(
      (e) => e.type,
    ),
    ['done'],
  );
  assert.deepEqual(
    deriveEventsFromStates(printing, { ...printing, state: 'error' }).map((e) => [
      e.type,
      e.reason,
    ]),
    [['failed', 'error']],
  );
  // OctoPrint itself unreachable: nothing is known, nothing is fired.
  assert.deepEqual(deriveEventsFromStates(printing, { ...printing, state: 'unreachable' }), []);
  assert.deepEqual(deriveEventsFromStates({ ...printing, state: 'unreachable' }, printing), []);
});

test('OctoPrint down: unreachable, then back by itself', async (t) => {
  const server = createOctoPrint();
  const { link } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  server.down = true;
  server.dropSockets();
  await wait(150);
  assert.equal(link.snapshot.state, 'unreachable');
  assert.equal(link.connected, false);
  assert.match(link.lastError, /unreachable/);
  server.down = false;
  await wait(200);
  assert.equal(link.connected, true);
  assert.equal(link.snapshot.state, 'operational');
});

test('a refused key is "unauthorized"; no key at all does not even try', async (t) => {
  const server = createOctoPrint();
  const { link } = linkTo(server, { apiKey: 'WRONG' });
  t.after(() => link.stop());
  link.start();
  await settle();
  assert.equal(link.snapshot.state, 'unauthorized');
  const silent = linkTo(server, { apiKey: '' }).link;
  const before = server.requests.length;
  silent.start();
  await settle();
  assert.equal(silent.snapshot.state, 'unauthorized');
  assert.equal(server.requests.length, before);
  silent.stop();
});

test('commands check the state first, and map the 409 of OctoPrint', async (t) => {
  const server = createOctoPrint();
  const { link } = linkTo(server);
  t.after(() => link.stop());
  link.start();
  await settle();
  await assert.rejects(link.command('pause'), { code: 'not_printing' });
  await assert.rejects(link.command('resume'), { code: 'not_paused' });
  await assert.rejects(link.command('cancel'), { code: 'not_printing' });
  assert.equal(server.commands.length, 0, 'nothing sent to OctoPrint');
  server.setState('printing');
  await settle();
  await link.command('pause');
  assert.deepEqual(server.commands.at(-1).body, { command: 'pause', action: 'pause' });
  // OctoPrint finished meanwhile: its 409 wins over our snapshot.
  server.setState('operational');
  link.snapshot = { ...link.snapshot, state: 'printing' };
  await assert.rejects(link.command('cancel'), { code: 'not_printing' });
  await link.command('targets', { tool0: 200, bed: 60 });
  assert.deepEqual(
    server.commands.slice(-2).map((c) => c.path),
    ['/api/printer/tool', '/api/printer/bed'],
  );
});
