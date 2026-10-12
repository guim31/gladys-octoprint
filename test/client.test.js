// The REST client against the fake OctoPrint (recorded answers) and against
// hand-made failures: kinds of errors, and the API key kept out of URLs and
// messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OctoPrintClient, OctoPrintError } from '../src/octoprint/client.js';
import { API_KEY, createOctoPrint, fixture } from './helpers/fakeOctoPrint.js';

const clientFor = (server, apiKey = API_KEY) =>
  new OctoPrintClient({ baseUrl: server.url, apiKey, fetch: server.fetch });

test('the key travels in the X-Api-Key header, never in the URL', async () => {
  const server = createOctoPrint();
  const client = clientFor(server);
  assert.deepEqual(await client.getVersion(), fixture('version.json'));
  const [request] = server.requests;
  assert.equal(request.key, API_KEY);
  assert.ok(!request.path.includes(API_KEY));
});

test('a refused key is "unauthorized", without the key in the message', async () => {
  const server = createOctoPrint();
  const client = clientFor(server, 'WRONG-KEY-123');
  await assert.rejects(client.getJob(), (err) => {
    assert.ok(err instanceof OctoPrintError);
    assert.equal(err.kind, 'unauthorized');
    assert.equal(err.status, 403);
    assert.ok(!err.message.includes('WRONG-KEY-123'));
    return true;
  });
});

test('getPrinter is null while the printer is disconnected (409)', async () => {
  const server = createOctoPrint({ state: 'offline' });
  assert.equal(await clientFor(server).getPrinter(), null);
  assert.equal((await clientFor(server).getJob()).state, 'Offline');
});

test('job commands answer 409 when there is nothing to pause', async () => {
  const server = createOctoPrint();
  await assert.rejects(clientFor(server).pause(), { kind: 'conflict', status: 409 });
  server.setState('printing');
  assert.equal(await clientFor(server).pause(), null);
  assert.deepEqual(server.commands.at(-1), {
    path: '/api/job',
    body: { command: 'pause', action: 'pause' },
  });
});

test('a heated chamber missing from the profile is a 409', async () => {
  const server = createOctoPrint();
  await assert.rejects(clientFor(server).setChamberTarget(30), { kind: 'conflict' });
  await clientFor(server).setToolTargets({ tool0: 210 });
  assert.deepEqual(server.commands.at(-1).body, { command: 'target', targets: { tool0: 210 } });
});

test('network errors, timeouts, redirects and foreign pages', async () => {
  const failing = (impl) =>
    new OctoPrintClient({ baseUrl: 'http://192.0.2.10', apiKey: 'K', fetch: impl });
  await assert.rejects(
    failing(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }).getVersion(),
    { kind: 'unreachable', message: 'OctoPrint unreachable (ECONNREFUSED)' },
  );
  await assert.rejects(
    failing(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }).getVersion(),
    { kind: 'unreachable', message: 'OctoPrint unreachable (timeout)' },
  );
  await assert.rejects(
    failing(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://192.0.2.10/api/version?x=1' },
        }),
    ).getVersion(),
    (err) => err.kind === 'http' && /https:\/\/192\.0\.2\.10\/api\/version,/.test(err.message),
  );
  await assert.rejects(
    failing(async () => new Response('<html>proxy</html>', { status: 200 })).getVersion(),
    { kind: 'invalid' },
  );
  await assert.rejects(
    failing(async () => new Response('<html>502</html>', { status: 502 })).getVersion(),
    { kind: 'http', status: 502 },
  );
});

test('the snapshot comes back as bytes with its type', async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const server = createOctoPrint({ image });
  const { type, data } = await clientFor(server).snapshot();
  assert.equal(type, 'image/jpeg');
  assert.deepEqual(data, image);
});
