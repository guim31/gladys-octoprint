// Scene actions: what reaches OctoPrint, and when a command is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, createOctoPrint, fixture, settle } from './helpers/fakeOctoPrint.js';
import { createWorld, deviceId } from './helpers/world.js';

const run = (world, key, fields) => world.gladys.fake.sceneAction(key, fields);

test('control_print: applied when there is something to pause, resume or cancel', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [server] = world.servers;
  const device = deviceId(1);
  assert.deepEqual((await run(world, 'control_print', { device, command: 'pause' })).data, {
    outputs: { applied: false },
  });
  server.setState('printing');
  await settle();
  assert.deepEqual((await run(world, 'control_print', { device, command: 'pause' })).data.outputs, {
    applied: true,
  });
  server.setState('paused');
  await settle();
  await run(world, 'control_print', { device, command: 'resume' });
  assert.deepEqual(server.commands.at(-1).body, { command: 'pause', action: 'resume' });
  await run(world, 'control_print', { device, command: 'cancel' });
  assert.deepEqual(server.commands.at(-1).body, { command: 'cancel' });
  const bad = await run(world, 'control_print', { device, command: 'explode' });
  assert.equal(bad.success, false);
});

test('an unknown printer or an unreachable OctoPrint fails the action', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const unknown = await run(world, 'control_print', { device: deviceId(3), command: 'pause' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /plus configurée/);
  world.servers[0].down = true;
  world.servers[0].dropSockets();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const down = await run(world, 'cool_down', { device: deviceId(1) });
  assert.equal(down.success, false);
  assert.match(down.error, /ne répond pas/);
});

test('preheat sets every nozzle and the bed, and is refused during a print', async (t) => {
  const server = createOctoPrint({ profiles: fixture('printerprofiles-dual-chamber.json') });
  const world = await createWorld({ octoprints: [server] });
  t.after(() => world.app.stop());
  const device = deviceId(1);
  const ack = await run(world, 'preheat', {
    device,
    tool_temperature: 215,
    bed_temperature: '65,4',
  });
  assert.deepEqual(ack.data.outputs, { applied: true });
  assert.deepEqual(
    server.commands.map((c) => [c.path, c.body]),
    [
      ['/api/printer/tool', { command: 'target', targets: { tool0: 215, tool1: 215 } }],
      ['/api/printer/bed', { command: 'target', target: 65 }],
    ],
  );
  // Defaults (PLA) when a field is empty.
  await run(world, 'preheat', { device });
  assert.deepEqual(server.commands.at(-2).body.targets, { tool0: 200, tool1: 200 });
  const tooHot = await run(world, 'preheat', { device, tool_temperature: 500 });
  assert.equal(tooHot.success, false);
  server.setState('printing');
  await settle();
  const count = server.commands.length;
  assert.deepEqual((await run(world, 'preheat', { device })).data.outputs, { applied: false });
  assert.equal(server.commands.length, count, 'temperatures untouched during a print');
});

test('cool_down turns every heater off, chamber included, even during a print', async (t) => {
  const server = createOctoPrint({
    profiles: fixture('printerprofiles-dual-chamber.json'),
    state: 'printing',
  });
  const world = await createWorld({
    octoprints: [server],
    config: { url_1: server.url, api_key_1: API_KEY },
  });
  t.after(() => world.app.stop());
  const ack = await run(world, 'cool_down', { device: deviceId(1) });
  assert.deepEqual(ack.data.outputs, { applied: true });
  assert.deepEqual(
    server.commands.map((c) => c.body),
    [
      { command: 'target', targets: { tool0: 0, tool1: 0 } },
      { command: 'target', target: 0 },
      { command: 'target', target: 0 },
    ],
  );
  assert.equal(server.commands.at(-1).path, '/api/printer/chamber');
});
