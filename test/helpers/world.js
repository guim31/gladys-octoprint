// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// fake OctoPrint instances on a fake network. Store under a temporary folder.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, createOctoPrint, network, settle } from './fakeOctoPrint.js';

export const FAST_TIMINGS = { pollInterval: 50, retryDelay: 50, cameraInterval: 60_000 };
export const FAST_SOCKET = { reconnectMin: 20, reconnectMax: 100, idleTimeout: 60_000 };

/**
 * @param {object} [options]
 * @param {object[]} [options.octoprints] fake instances (default: one, operational)
 * @param {object} [options.config] integration config (default: printer 1 on the first instance)
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  octoprints,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'octoprint-test-')),
  timings = FAST_TIMINGS,
  now,
} = {}) {
  const servers = octoprints ?? [createOctoPrint()];
  const net = network(...servers);
  const gladys = createFakeGladys({
    config: config ?? { url_1: servers[0].url, api_key_1: API_KEY },
    devices,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: net.fetch,
    createSocket: net.createSocket,
    timings,
    socketTimings: FAST_SOCKET,
    appKeyTimings: { interval: 5, lifetime: 2000 },
    now,
  });
  if (connect) {
    await gladys.connect();
    await settle();
  }
  return { gladys, app, hub: app.hub, servers, dataDir };
}

export const deviceId = (slot = 1) => `ext:test-integration:printer:${slot}`;
export const featureId = (key, slot = 1) => `${deviceId(slot)}:${key}`;
