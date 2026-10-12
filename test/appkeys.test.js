// The Application Keys workflow, with the answers recorded on OctoPrint 1.11.8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAME, requestAppKey, waitForAppKey } from '../src/octoprint/appkeys.js';
import { GRANTED_KEY, createOctoPrint } from './helpers/fakeOctoPrint.js';

const noSleep = async () => {};

test('a request returns the approval page of OctoPrint', async () => {
  const server = createOctoPrint();
  const { appToken, approvalUrl } = await requestAppKey({
    baseUrl: server.url,
    fetch: server.fetch,
  });
  assert.match(appToken, /^TOKEN-/);
  assert.equal(approvalUrl, `${server.url}/plugin/appkeys/auth/${appToken}`);
  const [request] = server.requests;
  assert.deepEqual(request.body, { app: APP_NAME });
  assert.equal(request.key, undefined, 'no key needed to ask for one');
});

test('the key arrives once the user approves; polling goes on meanwhile', async () => {
  const server = createOctoPrint();
  let polls = 0;
  const sleep = async () => {
    polls += 1;
    if (polls === 3) {
      server.decision = 'granted';
    }
  };
  const key = await waitForAppKey({
    baseUrl: server.url,
    appToken: 'T',
    fetch: server.fetch,
    sleep,
  });
  assert.equal(key, GRANTED_KEY);
  assert.equal(polls, 3);
});

test('a denied or expired request gives null', async () => {
  const server = createOctoPrint();
  server.decision = 'denied';
  assert.equal(
    await waitForAppKey({
      baseUrl: server.url,
      appToken: 'T',
      fetch: server.fetch,
      sleep: noSleep,
    }),
    null,
  );
});

test('the wait stops at the lifetime of the request, or when aborted', async () => {
  const server = createOctoPrint();
  let clock = 0;
  const key = await waitForAppKey({
    baseUrl: server.url,
    appToken: 'T',
    fetch: server.fetch,
    sleep: async () => {
      clock += 1000;
    },
    now: () => clock,
    lifetime: 5000,
  });
  assert.equal(key, null);
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    await waitForAppKey({
      baseUrl: server.url,
      appToken: 'T',
      fetch: server.fetch,
      signal: abort.signal,
    }),
    null,
  );
});

test('a disabled plugin and the rate limit are reported', async () => {
  const disabled = createOctoPrint({ appkeys: false });
  await assert.rejects(requestAppKey({ baseUrl: disabled.url, fetch: disabled.fetch }), {
    kind: 'not_found',
    message: /paste an API key/,
  });
  const server = createOctoPrint();
  for (let i = 0; i < 3; i += 1) {
    await requestAppKey({ baseUrl: server.url, fetch: server.fetch });
  }
  await assert.rejects(requestAppKey({ baseUrl: server.url, fetch: server.fetch }), {
    kind: 'rate_limited',
  });
});

test('before OctoPrint 1.10 (no approval page) the interface itself is opened', async () => {
  const fetch = async () => new Response(JSON.stringify({ app_token: 'OLD' }), { status: 201 });
  const { approvalUrl } = await requestAppKey({ baseUrl: 'http://192.0.2.10/octo', fetch });
  assert.equal(approvalUrl, 'http://192.0.2.10/octo/');
});

test('network hiccups while waiting are retried, then reported', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    waitForAppKey({ baseUrl: 'http://192.0.2.10', appToken: 'T', fetch, sleep: noSleep }),
    { kind: 'unreachable' },
  );
  assert.equal(calls, 5);
});
