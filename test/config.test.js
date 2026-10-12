import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeUrl } from '../src/config.js';

test('normalizeUrl accepts what users type and returns a base URL', () => {
  const cases = {
    '192.0.2.10': 'http://192.0.2.10',
    ' 192.0.2.10:5000 ': 'http://192.0.2.10:5000',
    'http://192.0.2.10/': 'http://192.0.2.10',
    'https://example.org/octoprint/': 'https://example.org/octoprint',
    'http://octopi.local': 'http://octopi.local',
    'HTTP://192.0.2.10': 'http://192.0.2.10',
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(normalizeUrl(raw), expected, raw);
  }
});

test('normalizeUrl refuses what cannot be an OctoPrint address', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://',
    'http://user:pw@192.0.2.10',
    42,
    null,
  ]) {
    assert.equal(normalizeUrl(raw), null, String(raw));
  }
});

test('normalizeConfig keeps the configured slots, flags the invalid ones', () => {
  const config = normalizeConfig({
    url_1: '192.0.2.10',
    api_key_1: ' KEY1 ',
    url_2: '',
    url_3: 'ftp://nope',
    api_key_3: 'KEY3',
    language: 'de',
  });
  assert.deepEqual(config.printers, [{ slot: 1, url: 'http://192.0.2.10', apiKey: 'KEY1' }]);
  assert.deepEqual(config.invalidSlots, [3]);
  assert.equal(config.language, 'de');
});

test('normalizeConfig falls back to the defaults', () => {
  for (const raw of [undefined, null, {}, { language: 'it' }]) {
    const config = normalizeConfig(raw);
    assert.deepEqual(config.printers, []);
    assert.equal(config.language, DEFAULT_CONFIG.language);
  }
  assert.equal(DEFAULT_CONFIG.language, 'fr');
  // A printer without key is kept: its device waits for Connect.
  assert.deepEqual(normalizeConfig({ url_2: '192.0.2.11' }).printers, [
    { slot: 2, url: 'http://192.0.2.11', apiKey: '' },
  ]);
});
