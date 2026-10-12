// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A refused command (nothing to pause, preheating during a print) is not an
// error of the scene: the action resolves `applied: false`, so the scene can
// go on or test it. An unreachable OctoPrint, or an unknown printer, throws
// (the action fails, the scene continues and logs it).
//
// The triggers (`print_started`, `print_done`...) are fired by the hub from
// OctoPrint's own events, never as an echo of these actions.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CommandError } from './hub.js';

const logger = createLogger({ name: 'octoprint-scenes' });

export const PRINT_COMMANDS = ['pause', 'resume', 'cancel'];

// Defaults of the preheat action (PLA), mirrored by the manifest.
export const PREHEAT_DEFAULTS = { tool_temperature: 200, bed_temperature: 60 };

const REFUSALS = new Set(['not_printing', 'not_paused', 'printing']);

async function applied(run, what) {
  try {
    await run();
    return { applied: true };
  } catch (err) {
    if (err instanceof CommandError && REFUSALS.has(err.code)) {
      logger.info(`${what}: not applied (${err.code})`);
      return { applied: false };
    }
    throw err;
  }
}

function temperature(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return number;
}

export const SCENE_ACTIONS = {
  control_print(hub, { fields }) {
    const command = fields.command;
    if (!PRINT_COMMANDS.includes(command)) {
      throw new Error(`Unknown print command ${command}`);
    }
    return applied(() => hub.command(fields.device, command), `control_print ${command}`);
  },

  preheat(hub, { fields }) {
    const tool = temperature(fields.tool_temperature, PREHEAT_DEFAULTS.tool_temperature);
    const bed = temperature(fields.bed_temperature, PREHEAT_DEFAULTS.bed_temperature);
    return applied(
      () => hub.setHeaters(fields.device, { tool, bed }, { refuseWhilePrinting: true }),
      'preheat',
    );
  },

  cool_down(hub, { fields }) {
    return applied(
      () => hub.setHeaters(fields.device, { tool: 0, bed: 0, chamber: 0 }),
      'cool_down',
    );
  },
};
