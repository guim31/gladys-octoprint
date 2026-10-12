// Reading the recorded OctoPrint answers (REST and push) into snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromPush,
  fromRest,
  readCapabilities,
  readTemperatures,
  sameStructure,
  stateCode,
} from '../src/octoprint/model.js';
import { STATES, fixture } from './helpers/fakeOctoPrint.js';

test('every recorded state is read from the REST answers', () => {
  const expected = {
    operational: 'operational',
    printing: 'printing',
    printingShort: 'printing',
    pausing: 'pausing',
    paused: 'paused',
    done: 'operational',
    cancelled: 'operational',
    offline: 'offline',
    error: 'error',
  };
  for (const [name, state] of Object.entries(expected)) {
    const [printer, job] = STATES[name]();
    assert.equal(fromRest(printer, job).state, state, name);
  }
});

test('a printing snapshot carries the file, the progress and the temperatures', () => {
  const snapshot = fromRest(...STATES.printingShort());
  assert.equal(snapshot.file, 'short.gcode');
  assert.equal(Math.round(snapshot.progress), 46);
  assert.equal(snapshot.printTime, 2);
  assert.equal(snapshot.printTimeLeft, 3);
  assert.deepEqual(Object.keys(snapshot.temperatures), ['bed', 'tool0']);
  // pyoctoprintapi's recorded job (MIT): a long print.
  const long = fromRest(
    fixture('printer-pyoctoprintapi.json'),
    fixture('job-printing-pyoctoprintapi.json'),
  );
  assert.equal(long.printTimeLeft, 12354);
  assert.equal(long.file, null);
});

test('after an emergency stop: Offline after error, with its message', () => {
  const snapshot = fromRest(...STATES.error());
  assert.equal(snapshot.state, 'error');
  assert.equal(snapshot.error, 'Closing serial port due to emergency stop M112.');
});

test('after a finished print the job keeps 100 %, after a cancellation it is cleared', () => {
  assert.equal(fromRest(...STATES.done()).progress, 100);
  assert.equal(fromRest(...STATES.cancelled()).progress, null);
});

test('state codes from flags and from the bare texts', () => {
  assert.equal(
    stateCode({ text: 'Offline after error', flags: { closedOrError: true, error: true } }),
    'error',
  );
  assert.equal(
    stateCode({ text: 'Cancelling', flags: { printing: true, cancelling: true } }),
    'cancelling',
  );
  assert.equal(
    stateCode({ text: 'Finishing', flags: { printing: true, finishing: true } }),
    'finishing',
  );
  assert.equal(
    stateCode({ text: 'Resuming', flags: { resuming: true, paused: true } }),
    'resuming',
  );
  assert.equal(stateCode({ text: 'Detecting serial connection' }), 'connecting');
  assert.equal(stateCode({ text: 'Opening serial connection' }), 'connecting');
  assert.equal(stateCode({ text: 'Starting' }), 'printing');
  assert.equal(stateCode({ text: 'Offline' }), 'offline');
  assert.equal(stateCode(null), 'offline');
});

test('the push session recorded during a real print reads like the REST answers', () => {
  const session = fixture('push-session.json');
  const history = session.find((entry) => entry.message.history).message.history;
  assert.equal(fromPush(history).state, 'operational');
  const states = session
    .filter((entry) => entry.message.current)
    .map((entry) => fromPush(entry.message.current).state);
  for (const state of ['printing', 'pausing', 'paused', 'operational', 'offline']) {
    assert.ok(states.includes(state), `${state} seen in the push session`);
  }
  // The chamber of a printer without one comes with null values: dropped.
  const withTemps = session.find((e) => e.message.current?.temps?.length > 0).message.current;
  const temps = fromPush(withTemps).temperatures;
  assert.deepEqual(Object.keys(temps).sort(), ['bed', 'tool0']);
  // A message without temperatures leaves them undefined (kept by the caller).
  assert.equal(
    fromPush({ state: { text: 'Operational', flags: { operational: true } }, temps: [] })
      .temperatures,
    undefined,
  );
});

test('temperatures: heaters only, nulls dropped', () => {
  assert.deepEqual(
    readTemperatures({
      tool0: { actual: 200.4, target: 210 },
      chamber: { actual: null, target: null },
      time: 1791832240,
      bed: { actual: 59.9, target: null },
    }),
    { tool0: { actual: 200.4, target: 210 }, bed: { actual: 59.9, target: null } },
  );
  assert.deepEqual(readTemperatures(null), {});
});

test('capabilities from the printer profiles and the settings', () => {
  const single = readCapabilities(
    fixture('printerprofiles.json'),
    fixture('settings-no-webcam.json'),
  );
  assert.deepEqual(single, {
    name: '',
    model: 'Generic RepRap Printer',
    tools: ['tool0'],
    bed: true,
    chamber: false,
    camera: false,
  });
  const dual = readCapabilities(
    fixture('printerprofiles-dual-chamber.json'),
    fixture('settings.json'),
  );
  assert.deepEqual(dual.tools, ['tool0', 'tool1']);
  assert.equal(dual.chamber, true);
  assert.equal(dual.camera, true);
  assert.equal(dual.name, 'Virtual MK3');
  // A key without the settings permission: no name, no webcam, still a device.
  const restricted = readCapabilities(fixture('printerprofiles.json'), null);
  assert.equal(restricted.camera, false);
  assert.ok(sameStructure(single, restricted));
  assert.ok(!sameStructure(single, dual));
  // A shared nozzle has one heater.
  const shared = structuredClone(fixture('printerprofiles-dual-chamber.json'));
  Object.values(shared.profiles).forEach((p) => (p.extruder.sharedNozzle = true));
  assert.deepEqual(readCapabilities(shared, null).tools, ['tool0']);
});
