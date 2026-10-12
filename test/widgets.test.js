// The `printer` dashboard widget: contents checked with the SDK validator (the
// core's vocabulary and budget), live tiles cross-checked with the discovered
// devices (the validator does not know them), buttons by state, actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createOctoPrint, fixture, settle } from './helpers/fakeOctoPrint.js';
import { createWorld, deviceId } from './helpers/world.js';

const get = async (world, settings, language = 'en', units = 'metric') => {
  const ack = await world.gladys.fake.widgetGet('printer', { settings, language, units });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

function assertLinkedFeatures(world, content) {
  const features = new Set(
    world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  for (const component of content.components) {
    if (component.device_feature) {
      assert.ok(features.has(component.device_feature), `${component.device_feature} exists`);
    }
  }
}

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);
const status = (content) =>
  Object.fromEntries(
    content.components.find((c) => c.type === 'status').items.map((i) => [i.label, i.value]),
  );

test('without a printer, or with an unknown one, the widget says what to do', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const [settings, pattern] of [
    [{}, /Choose an OctoPrint printer/],
    [{ device: deviceId(3) }, /not configured/],
  ]) {
    const content = await get(world, settings);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.match(content.components[0].text, pattern);
  }
  assert.match((await get(world, {}, 'de')).components[0].text, /Wähle einen OctoPrint-Drucker/);
});

test('every state renders within the budget, with the buttons that make sense', async (t) => {
  const server = createOctoPrint({ settings: fixture('settings.json') });
  const world = await createWorld({ octoprints: [server] });
  t.after(() => world.app.stop());
  const settings = { device: deviceId(1) };
  const expected = {
    operational: ['preheat'],
    printing: ['pause', 'cancel'],
    pausing: ['resume', 'cancel'],
    paused: ['resume', 'cancel'],
    done: ['preheat'],
    offline: [],
  };
  for (const [state, keys] of Object.entries(expected)) {
    server.setState(state);
    await settle();
    for (const language of ['en', 'fr', 'de', 'es']) {
      const content = await get(world, settings, language);
      assert.deepEqual(validateWidgetContent(content), [], `${state} ${language}`);
      assertLinkedFeatures(world, content);
      assert.deepEqual(buttons(content), keys, `${state} ${language}`);
    }
  }
  // Cancelling asks first, in the danger style.
  server.setState('printing');
  await settle();
  const cancel = (await get(world, settings)).components.find((c) => c.action?.key === 'cancel');
  assert.equal(cancel.action.confirm, true);
  assert.equal(cancel.style, 'danger');
});

test('a print in progress: elapsed time, end time, targets', async (t) => {
  const world = await createWorld({
    octoprints: [createOctoPrint({ state: 'printingShort' })],
    now: () => Date.parse('2026-10-12T18:00:00Z'),
  });
  t.after(() => world.app.stop());
  const content = await get(world, { device: deviceId(1) }, 'en');
  const rows = status(content);
  assert.equal(rows.State, 'Printing');
  assert.equal(rows.File, 'short.gcode');
  assert.equal(rows.Elapsed, '0 min');
  assert.ok(rows['Ends at']);
  assert.equal(content.ttl_seconds, 30);
  assert.deepEqual(
    content.components
      .filter((c) => c.device_feature)
      .map((c) => c.device_feature.split(':').at(-1)),
    ['progress', 'time_left', 'tool0_temperature', 'bed_temperature'],
  );
});

test('targets in the unit system of the user; cool down once something heats', async (t) => {
  const server = createOctoPrint({ state: 'pausing' });
  const world = await createWorld({ octoprints: [server] });
  t.after(() => world.app.stop());
  const settings = { device: deviceId(1) };
  assert.equal(status(await get(world, settings, 'en')).Targets, '210 °C / 60 °C');
  assert.equal(status(await get(world, settings, 'en', 'us')).Targets, '410 °F / 140 °F');
  server.setState('done');
  await settle();
  assert.deepEqual(buttons(await get(world, settings)), ['preheat']);
  server.printer.temperature.tool0.target = 200;
  server.setState('operational');
  server.printer.temperature.tool0.target = 200;
  server.pushCurrent();
  await settle();
  assert.deepEqual(buttons(await get(world, settings)), ['preheat', 'cool_down']);
});

test('widget actions run the command and answer a toast in four languages', async (t) => {
  const server = createOctoPrint();
  const world = await createWorld({ octoprints: [server] });
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  const act = (key, settings = { device: deviceId(1) }) =>
    fake.widgetAction('printer', key, {}, { settings });

  const refused = await act('pause');
  assert.equal(refused.success, true);
  assert.equal(refused.data.message.fr, 'Aucune impression en cours.');

  const preheat = await act('preheat');
  assert.equal(preheat.data.message.en, 'Preheating.');
  assert.deepEqual(
    server.commands.slice(-2).map((c) => c.body),
    [
      { command: 'target', targets: { tool0: 200 } },
      { command: 'target', target: 60 },
    ],
  );
  await act('preheat', { device: deviceId(1), preheat_tool: 240, preheat_bed: '85' });
  assert.deepEqual(server.commands.at(-2).body.targets, { tool0: 240 });
  assert.deepEqual(server.commands.at(-1).body, { command: 'target', target: 85 });

  await act('cool_down');
  assert.deepEqual(server.commands.at(-1).body, { command: 'target', target: 0 });

  server.setState('printing');
  await settle();
  assert.equal((await act('cancel')).data.message.de, 'Abbruch angefordert.');
  assert.deepEqual(server.commands.at(-1).body, { command: 'cancel' });

  const unknown = await act('pause', {});
  assert.match(unknown.data.message.en, /not configured/);
});
