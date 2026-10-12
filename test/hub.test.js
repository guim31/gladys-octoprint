// The integration end to end, on the SDK's fake Gladys and fake OctoPrint
// instances: devices, states, scene events, commands, connection status, the
// Connect flow, persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, GRANTED_KEY, createOctoPrint, fixture, settle } from './helpers/fakeOctoPrint.js';
import { createWorld, deviceId, featureId } from './helpers/world.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1000, 7)]);

test('one device per OctoPrint, its states, and nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const [device] = fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(1));
  assert.equal(device.name, 'OctoPrint');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [{ name: 'OCTOPRINT_URL', value: 'http://192.0.2.10' }]);
  assert.equal(fake.lastState(featureId('state')), 'Opérationnelle');
  assert.equal(fake.lastState(featureId('file')), 'Aucun fichier');
  assert.equal(fake.lastState(featureId('tool0_temperature')), 21);
  assert.equal(fake.lastState(featureId('progress')), 0);
  assert.deepEqual(fake.connectionStatus, { connected: true });
});

test('a print: states follow, only the changes are published', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const [server] = world.servers;
  server.setState('printingShort');
  await settle();
  assert.equal(fake.lastState(featureId('state')), 'Impression');
  assert.equal(fake.lastState(featureId('file')), 'short.gcode');
  assert.equal(fake.lastState(featureId('progress')), 46);
  assert.equal(fake.lastState(featureId('time_left')), 0); // 3 s, rounded
  const count = fake.states.length;
  server.pushCurrent();
  await settle();
  assert.equal(fake.states.length, count, 'an identical update publishes nothing');
  server.setState('done');
  await settle();
  assert.equal(fake.lastState(featureId('progress')), 100);
  assert.equal(fake.lastState(featureId('state')), 'Opérationnelle');
  server.setState('cancelled');
  await settle();
  assert.equal(fake.lastState(featureId('progress')), 0);
});

test('states are published again when the user adds the device', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const before = fake.states.length;
  await fake.deviceCreated(fake.discoveredDevices[0]);
  await settle();
  const again = fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(again.includes(featureId('state')));
  assert.ok(again.includes(featureId('tool0_target')));
  assert.ok(fake.widgetRefreshes.includes('printer'));
});

test('print events fire the scene triggers with their variables', async (t) => {
  const world = await createWorld({
    config: { url_1: '192.0.2.10', api_key_1: API_KEY, language: 'en' },
  });
  t.after(() => world.app.stop());
  const [server] = world.servers;
  server.emitEvent('PrintDone', { name: 'benchy.gcode', time: 3930 });
  server.emitEvent('PrintFailed', { name: 'benchy.gcode', time: 61, reason: 'error' });
  await settle();
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: 'print_done',
      data: {
        device: deviceId(1),
        printer: 'OctoPrint',
        file: 'benchy.gcode',
        duration: '1 h 06 min',
        duration_minutes: 66,
      },
    },
    {
      key: 'print_failed',
      data: {
        device: deviceId(1),
        printer: 'OctoPrint',
        file: 'benchy.gcode',
        duration: '1 min',
        duration_minutes: 1,
        reason: 'error',
      },
    },
  ]);
});

test('setpoints and buttons of the device box', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const [server] = world.servers;
  const device = fake.discoveredDevices[0];
  const feature = (key) => device.features.find((f) => f.external_id === featureId(key));

  assert.deepEqual(await fake.setValue(device, feature('tool0_target'), 215.4), { success: true });
  assert.deepEqual(server.commands.at(-1), {
    path: '/api/printer/tool',
    body: { command: 'target', targets: { tool0: 215 } },
  });
  await fake.setValue(device, feature('bed_target'), 60);
  assert.deepEqual(server.commands.at(-1).body, { command: 'target', target: 60 });

  const tooHot = await fake.setValue(device, feature('bed_target'), 400);
  assert.equal(tooHot.success, false);
  assert.match(tooHot.error, /0 à 150 °C/);

  const idle = await fake.setValue(device, feature('pause'), 1);
  assert.equal(idle.success, false);
  assert.equal(idle.error, 'Aucune impression en cours.');

  server.setState('printing');
  await settle();
  assert.equal((await fake.setValue(device, feature('pause'), 1)).success, true);
  assert.deepEqual(server.commands.at(-1).body, { command: 'pause', action: 'pause' });

  const readOnly = await fake.setValue(device, feature('progress'), 3);
  assert.equal(readOnly.success, false);
});

test('connection status: no address, no key, refused key, OctoPrint down', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  assert.equal(empty.gladys.fake.connectionStatus.connected, false);
  assert.match(empty.gladys.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  assert.deepEqual(empty.gladys.fake.discoveredDevices, []);

  const noKey = await createWorld({ config: { url_1: '192.0.2.10' } });
  t.after(() => noKey.app.stop());
  assert.match(noKey.gladys.fake.connectionStatus.message.en, /Printer 1: click Connect/);

  const refused = await createWorld({ config: { url_1: '192.0.2.10', api_key_1: 'WRONG' } });
  t.after(() => refused.app.stop());
  assert.match(refused.gladys.fake.connectionStatus.message.de, /API-Schlüssel abgelehnt/);

  const invalid = await createWorld({
    config: { url_1: '192.0.2.10', api_key_1: API_KEY, url_2: 'ftp://x' },
  });
  t.after(() => invalid.app.stop());
  assert.match(invalid.gladys.fake.connectionStatus.message.es, /Impresora 2: dirección no válida/);

  const world = await createWorld();
  t.after(() => world.app.stop());
  const [server] = world.servers;
  server.down = true;
  server.dropSockets();
  await wait(150);
  const status = world.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Imprimante 1 : OctoPrint ne répond pas/);
  assert.equal(world.gladys.fake.lastState(featureId('state')), 'OctoPrint injoignable');
  server.down = false;
  await wait(200);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('Connect: approved in OctoPrint, the key is saved and the printer connects', async (t) => {
  const server = createOctoPrint();
  const world = await createWorld({ octoprints: [server], config: { url_1: server.url } });
  t.after(() => world.app.stop());
  server.apiKey = GRANTED_KEY;
  const fake = world.gladys.fake;
  const ack = await fake.oauthAuthorizeUrl('link_1');
  assert.equal(ack.success, true);
  assert.match(ack.data.authorize_url, /^http:\/\/192\.0\.2\.10\/plugin\/appkeys\/auth\/TOKEN-/);
  await settle();
  assert.match(fake.connectionStatus.message.fr, /acceptez la demande d'accès/);
  server.decision = 'granted';
  await world.hub.linkDone;
  await settle();
  assert.equal(fake.config.api_key_1, GRANTED_KEY);
  const saved = fake.bodies('POST', '/config');
  assert.deepEqual(saved.at(-1), { config: { api_key_1: GRANTED_KEY } });
  assert.deepEqual(fake.connectionStatus, { connected: true });
  assert.equal(fake.discoveredDevices.length, 1);
});

test('Connect: denied, unknown slot, address not saved yet', async (t) => {
  const server = createOctoPrint();
  const world = await createWorld({ octoprints: [server], config: { url_1: server.url } });
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  await fake.oauthAuthorizeUrl('link_1');
  server.decision = 'denied';
  await world.hub.linkDone;
  await settle();
  assert.match(fake.connectionStatus.message.en, /access request denied or expired/);
  const missing = await fake.oauthAuthorizeUrl('link_2');
  assert.equal(missing.success, false);
  assert.match(missing.error, /enter and save the address/);
});

test('three printers; the webcam image is pulled, and pushed once the device exists', async (t) => {
  const servers = [
    createOctoPrint({ host: '192.0.2.10' }),
    createOctoPrint({
      host: '192.0.2.11',
      profiles: fixture('printerprofiles-dual-chamber.json'),
      settings: fixture('settings.json'),
      image: JPEG,
    }),
    createOctoPrint({ host: '192.0.2.12', state: 'offline' }),
  ];
  const world = await createWorld({
    octoprints: servers,
    config: {
      url_1: servers[0].url,
      api_key_1: API_KEY,
      url_2: servers[1].url,
      api_key_2: API_KEY,
      url_3: servers[2].url,
      api_key_3: API_KEY,
    },
  });
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  assert.deepEqual(
    fake.discoveredDevices.map((d) => d.name),
    ['OctoPrint', 'Virtual MK3', 'OctoPrint 3'],
  );
  assert.equal(fake.lastState(featureId('state', 3)), 'Imprimante déconnectée');
  const dual = fake.discoveredDevices[1];
  const image = await fake.getImage(dual);
  assert.equal(image.success, true);
  assert.equal(image.data.image, `image/jpg;base64,${JPEG.toString('base64')}`);
  const noCamera = await fake.getImage(fake.discoveredDevices[0]);
  assert.equal(noCamera.success, false);

  await fake.deviceCreated(dual);
  await settle();
  assert.equal(fake.cameraImages.at(-1).device_external_id, featureId('camera', 2));

  // Too large for Gladys, or not a JPEG: a clear message.
  servers[1].image = Buffer.concat([JPEG, Buffer.alloc(150 * 1024)]);
  assert.match((await fake.getImage(dual)).error, /dépasse 150 Ko/);
  servers[1].image = Buffer.from('89504e470d0a', 'hex');
  assert.match((await fake.getImage(dual)).error, /pas un JPEG/);
});

test('a restart while OctoPrint is off still publishes the known device', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const server = createOctoPrint();
  server.down = true;
  const second = await createWorld({ octoprints: [server], dataDir: first.dataDir });
  t.after(() => second.app.stop());
  const fake = second.gladys.fake;
  assert.equal(fake.discoveredDevices.length, 1);
  assert.equal(fake.discoveredDevices[0].external_id, deviceId(1));
  // The structure did not change: same features as on the first run.
  assert.deepEqual(
    fake.discoveredDevices[0].features.map((f) => f.external_id),
    first.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id),
  );
  // The first attempt failed: the status says so, the state too.
  await wait(20);
  assert.equal(fake.connectionStatus.connected, false);
});

test('a new configuration: language, address, removed printer', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  await fake.configUpdated({ url_1: '192.0.2.10', api_key_1: API_KEY, language: 'es' });
  await settle();
  assert.equal(fake.lastState(featureId('state')), 'Operativa');
  assert.equal(world.servers[0].sockets.filter((s) => !s.closed).length, 1, 'link kept');
  await fake.configUpdated({ language: 'es' });
  await settle();
  assert.deepEqual(fake.discoveredDevices, []);
  assert.equal(world.servers[0].sockets.filter((s) => !s.closed).length, 0, 'link closed');
});

test('a scan republishes, a poll reads the REST API, the test action reports', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const before = world.servers[0].requests.length;
  await fake.poll(fake.discoveredDevices[0]);
  assert.ok(world.servers[0].requests.slice(before).some((r) => r.path === '/api/job'));
  await fake.scanRequest();
  assert.equal(fake.discoveredDevices.length, 1);
  const report = await fake.action('test_connection');
  assert.equal(report.data.message.fr, 'Imprimante 1 : OctoPrint 1.11.8, Opérationnelle.');
  assert.equal(report.data.message.de, 'Drucker 1: OctoPrint 1.11.8, Betriebsbereit.');
});

test('the widget refresh nudges respect the core limit of one per 10 s', async (t) => {
  let clock = 1_000_000;
  const world = await createWorld({ now: () => clock });
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const count = fake.widgetRefreshes.length;
  world.hub.refreshWidget();
  world.hub.refreshWidget();
  assert.equal(fake.widgetRefreshes.length, count, 'within 10 s of the start nudge');
  clock += 11_000;
  world.hub.refreshWidget();
  assert.equal(fake.widgetRefreshes.length, count + 1);
});
