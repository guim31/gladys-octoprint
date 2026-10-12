// -----------------------------------------------------------------------------
// OctoPrint instance -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - state, file: text/text (two of them: the dashboard then shows their names);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label (the precedent of gladys-ipp's supply levels);
// - elapsed, left: duration/integer in minutes (duration/decimal is a slider);
// - temperatures: temperature-sensor/decimal;
// - targets: thermostat/target-temperature, the setpoint row (+/-, typed value);
// - pause, resume: button/push, the "Push" row button.
// Cancelling is not a device button: one tap, no confirmation, a ruined
// print. It is offered by the widget (with a confirmation) and the scenes.
//
// Feature keys are forever: `tool0_target`, never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { ACTIVE_STATES } from './octoprint/model.js';
import { NAMES, STATE_LABELS, NO_FILE } from './texts.js';

export const DEVICE_TYPE = 'printer';

// Display bounds of the features (Gladys never enforces them on writes: the
// command handler does, with the same values).
export const LIMITS = {
  tool: 350,
  bed: 150,
  chamber: 100,
};
const MAX_MINUTES = 100_000; // about 70 days

export const COMMAND_KEYS = ['pause', 'resume'];

export function deviceIds(gladys, slot) {
  return gladys.externalIds(DEVICE_TYPE, String(slot));
}

/** `tool0` -> `nozzle`, `tool1` -> `nozzle 2`... */
function heaterName(names, heater) {
  if (heater === 'bed' || heater === 'chamber') {
    return names[heater];
  }
  const index = Number(heater.slice(4));
  return index === 0 ? names.tool : `${names.tool} ${index + 1}`;
}

export function heaterLimit(heater) {
  return heater.startsWith('tool') ? LIMITS.tool : LIMITS[heater];
}

/** Heaters the device publishes, in a stable order. */
export function heatersOf(capabilities) {
  return [
    ...capabilities.tools,
    ...(capabilities.bed ? ['bed'] : []),
    ...(capabilities.chamber ? ['chamber'] : []),
  ];
}

export function defaultName(slot, capabilities) {
  if (capabilities?.name) {
    return capabilities.name.slice(0, 60);
  }
  return slot === 1 ? 'OctoPrint' : `OctoPrint ${slot}`;
}

/**
 * @param {object} gladys
 * @param {{ slot: number, url: string, capabilities: object }} printer
 * @param {string} language
 */
export function buildDevice(gladys, { slot, url, capabilities }, language) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, slot);
  const feature = (key, name, fields) => ({
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };
  const minutes = {
    category: CAT.DURATION,
    type: TYPE.DURATION.INTEGER,
    unit: UNIT.MINUTES,
    min: 0,
    max: MAX_MINUTES,
  };

  const features = [
    feature('state', names.state, text),
    feature('file', names.file, text),
    feature('progress', names.progress, {
      category: CAT.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    feature('time_elapsed', names.elapsed, minutes),
    feature('time_left', names.left, minutes),
  ];

  for (const heater of heatersOf(capabilities)) {
    const label = heaterName(names, heater);
    const max = heaterLimit(heater);
    features.push(
      feature(`${heater}_temperature`, label, {
        category: CAT.TEMPERATURE_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.CELSIUS,
        min: 0,
        max,
      }),
      feature(`${heater}_target`, `${label} (${names.target})`, {
        category: CAT.THERMOSTAT,
        type: TYPE.THERMOSTAT.TARGET_TEMPERATURE,
        unit: UNIT.CELSIUS,
        min: 0,
        max,
        read_only: false,
        has_feedback: true,
      }),
    );
  }

  for (const key of COMMAND_KEYS) {
    features.push(
      feature(key, names[key], {
        category: CAT.BUTTON,
        type: TYPE.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
      }),
    );
  }

  if (capabilities.camera) {
    features.push(
      feature('camera', names.camera, {
        category: CAT.CAMERA,
        type: TYPE.CAMERA.IMAGE,
        min: 0,
        max: 0,
      }),
    );
  }

  return {
    name: defaultName(slot, capabilities),
    external_id: ids.device,
    model: capabilities.model ? capabilities.model.slice(0, 60) : 'OctoPrint',
    should_poll: false,
    features,
    params: [{ name: 'OCTOPRINT_URL', value: url }],
  };
}

const round = (value) => (value === null ? null : Math.round(value));
const toMinutes = (seconds) => (seconds === null ? null : Math.round(seconds / 60));

/**
 * Feature states of a snapshot, in the publishStates format. Temperatures are
 * whole degrees and durations whole minutes: the push link sends a sample
 * every 5 s and Gladys takes 300 states a minute for the whole integration.
 * Unknown values are left out (Gladys keeps the last one).
 */
export function buildStates(gladys, { slot, capabilities }, snapshot, language) {
  const ids = deviceIds(gladys, slot);
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const addText = (key, text) => {
    states.push({ device_feature_external_id: ids.feature(key), text: String(text).slice(0, 200) });
  };

  addText('state', (STATE_LABELS[language] ?? STATE_LABELS.en)[snapshot.state]);
  if (['unreachable', 'unauthorized'].includes(snapshot.state)) {
    // OctoPrint does not answer: everything else keeps its last value.
    return states;
  }
  addText('file', snapshot.file ?? NO_FILE[language] ?? NO_FILE.en);
  const active = ACTIVE_STATES.has(snapshot.state);
  // Idle after a finished print, OctoPrint keeps the last job (100 %, its
  // duration); after a cancellation it clears it: 0 then.
  add('progress', snapshot.progress === null ? 0 : Math.round(snapshot.progress));
  add('time_elapsed', snapshot.printTime === null ? 0 : toMinutes(snapshot.printTime));
  add('time_left', active ? toMinutes(snapshot.printTimeLeft) : 0);

  for (const heater of heatersOf(capabilities)) {
    const reading = snapshot.temperatures[heater];
    if (reading) {
      add(`${heater}_temperature`, round(reading.actual));
      add(`${heater}_target`, round(reading.target));
    }
  }
  return states;
}

/** `ext:...:printer:2` -> 2, or null when the id is not one of ours. */
export function slotOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const slot = Number(externalId.slice(prefix.length).split(':')[0]);
  return Number.isInteger(slot) ? slot : null;
}

/** The feature key of a feature external id (`...:printer:1:tool0_target` -> `tool0_target`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
