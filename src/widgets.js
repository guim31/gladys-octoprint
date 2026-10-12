// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `printer`, "3D print".
//
// The Gladys device box already lists every feature. What the widget adds:
// the print at a glance (progress gauge, time left, temperatures as live
// tiles), when it will finish, and the buttons that matter in the current
// state — pause or resume, cancel (with a confirmation: the device box has
// no cancel button on purpose), preheat or cool down when idle.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons, 2 texts): at most four
// tiles, one status list and two buttons. No button opens a form, so Gladys
// 5.1 is enough: the preheat temperatures are widget settings.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds, heatersOf } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { ACTIVE_STATES } from './octoprint/model.js';
import { PREHEAT_DEFAULTS } from './scenes.js';
import { DONE_TEXT, STATE_LABELS, formatDuration } from './texts.js';

export { WIDGET_KEY };

export const TEXT = {
  pick: {
    en: 'Choose an OctoPrint printer in the widget settings.',
    fr: 'Choisissez une imprimante OctoPrint dans les réglages du widget.',
    de: 'Wähle einen OctoPrint-Drucker in den Widget-Einstellungen.',
    es: 'Elija una impresora OctoPrint en los ajustes del widget.',
  },
  unknown: {
    en: 'This printer is not configured in the OctoPrint integration anymore.',
    fr: "Cette imprimante n'est plus configurée dans l'intégration OctoPrint.",
    de: 'Dieser Drucker ist in der OctoPrint-Integration nicht mehr eingerichtet.',
    es: 'Esta impresora ya no está configurada en la integración OctoPrint.',
  },
  waiting: {
    en: 'Waiting for OctoPrint to answer.',
    fr: "En attente d'une réponse d'OctoPrint.",
    de: 'Warte auf eine Antwort von OctoPrint.',
    es: 'Esperando la respuesta de OctoPrint.',
  },
  progress: { en: 'Progress', fr: 'Progression', de: 'Fortschritt', es: 'Progreso' },
  left: { en: 'Time left', fr: 'Restant', de: 'Restzeit', es: 'Restante' },
  tool: { en: 'Nozzle', fr: 'Buse', de: 'Düse', es: 'Boquilla' },
  bed: { en: 'Bed', fr: 'Plateau', de: 'Druckbett', es: 'Cama' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  file: { en: 'File', fr: 'Fichier', de: 'Datei', es: 'Archivo' },
  elapsed: { en: 'Elapsed', fr: 'Écoulé', de: 'Verstrichen', es: 'Transcurrido' },
  finish: { en: 'Ends at', fr: 'Fin vers', de: 'Fertig um', es: 'Termina a las' },
  targets: { en: 'Targets', fr: 'Consignes', de: 'Solltemperaturen', es: 'Consignas' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pausieren', es: 'Pausar' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  cancel: { en: 'Cancel', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar' },
  preheat: { en: 'Preheat', fr: 'Préchauffer', de: 'Vorheizen', es: 'Precalentar' },
  cool_down: { en: 'Cool down', fr: 'Refroidir', de: 'Abkühlen', es: 'Enfriar' },
};

const STATE_COLORS = {
  unreachable: WIDGET_COLORS.DANGER,
  unauthorized: WIDGET_COLORS.DANGER,
  error: WIDGET_COLORS.DANGER,
  offline: WIDGET_COLORS.NEUTRAL,
  connecting: WIDGET_COLORS.NEUTRAL,
  operational: WIDGET_COLORS.SUCCESS,
  printing: WIDGET_COLORS.PRIMARY,
  resuming: WIDGET_COLORS.PRIMARY,
  finishing: WIDGET_COLORS.PRIMARY,
  pausing: WIDGET_COLORS.WARNING,
  paused: WIDGET_COLORS.WARNING,
  cancelling: WIDGET_COLORS.WARNING,
};

export const WIDGET_ACTIONS = ['pause', 'resume', 'cancel', 'preheat', 'cool_down'];

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

function temperatureText(celsius, units) {
  const value = units === 'us' ? Math.round((celsius * 9) / 5 + 32) : Math.round(celsius);
  return `${value} °${units === 'us' ? 'F' : 'C'}`;
}

function clockTime(date, language) {
  try {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function button(language, key, icon, extra = {}) {
  return { type: 'button', label: pick(TEXT[key], language), icon, action: { key }, ...extra };
}

/**
 * The widget content for a printer.
 * @param {object} hub
 * @param {{ settings?: object, language?: string, units?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en', units = 'metric' }) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return textOnly(pick(TEXT.pick, lang), 300);
  }
  const printer = [...hub.printers.values()].find(
    (p) => deviceIds(hub.gladys, p.slot).device === settings.device,
  );
  if (!printer) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  if (!printer.capabilities) {
    return textOnly(pick(TEXT.waiting, lang), 30);
  }
  const ids = deviceIds(hub.gladys, printer.slot);
  const snapshot = printer.link.snapshot;
  const active = ACTIVE_STATES.has(snapshot.state);
  const components = [
    {
      type: 'gauge',
      label: pick(TEXT.progress, lang),
      device_feature: ids.feature('progress'),
      color: WIDGET_COLORS.PRIMARY,
    },
    { type: 'value', label: pick(TEXT.left, lang), device_feature: ids.feature('time_left') },
    {
      type: 'value',
      label: pick(TEXT.tool, lang),
      device_feature: ids.feature(`${printer.capabilities.tools[0]}_temperature`),
    },
  ];
  if (printer.capabilities.bed) {
    components.push({
      type: 'value',
      label: pick(TEXT.bed, lang),
      device_feature: ids.feature('bed_temperature'),
    });
  }

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: STATE_LABELS[lang][snapshot.state].slice(0, 40),
      color: STATE_COLORS[snapshot.state],
    },
  ];
  if (snapshot.file && !['unreachable', 'unauthorized'].includes(snapshot.state)) {
    items.push({ label: pick(TEXT.file, lang), value: snapshot.file.slice(0, 40), icon: 'file' });
  }
  if (active && snapshot.printTime !== null) {
    items.push({
      label: pick(TEXT.elapsed, lang),
      value: formatDuration(snapshot.printTime, lang),
      icon: 'clock',
    });
  }
  if (active && snapshot.printTimeLeft !== null && snapshot.state !== 'paused') {
    items.push({
      label: pick(TEXT.finish, lang),
      value: clockTime(new Date(hub.now() + snapshot.printTimeLeft * 1000), lang),
      icon: 'flag',
    });
  }
  // Nozzles first, then bed and chamber.
  const targets = heatersOf(printer.capabilities)
    .map((heater) => snapshot.temperatures[heater]?.target ?? 0)
    .filter((target) => target > 0)
    .map((target) => temperatureText(target, units));
  if (targets.length > 0) {
    items.push({
      label: pick(TEXT.targets, lang),
      value: targets.join(' / ').slice(0, 40),
      icon: 'thermometer',
    });
  }
  components.push({ type: 'status', items });

  const cancel = button(lang, 'cancel', 'x-circle', { style: 'danger' });
  cancel.action.confirm = true;
  if (['printing', 'resuming'].includes(snapshot.state)) {
    components.push(button(lang, 'pause', 'pause'), cancel);
  } else if (['paused', 'pausing'].includes(snapshot.state)) {
    components.push(button(lang, 'resume', 'play'), cancel);
  } else if (snapshot.state === 'operational') {
    components.push(button(lang, 'preheat', 'thermometer'));
    if (targets.length > 0) {
      components.push(button(lang, 'cool_down', 'wind'));
    }
  }

  return { ttl_seconds: active ? 30 : 300, components };
}

function settingNumber(value, fallback) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      const device = settings.device;
      try {
        switch (actionKey) {
          case 'pause':
          case 'resume':
          case 'cancel':
            await hub.command(device, actionKey);
            break;
          case 'preheat':
            await hub.setHeaters(
              device,
              {
                tool: settingNumber(settings.preheat_tool, PREHEAT_DEFAULTS.tool_temperature),
                bed: settingNumber(settings.preheat_bed, PREHEAT_DEFAULTS.bed_temperature),
              },
              { refuseWhilePrinting: true },
            );
            break;
          case 'cool_down':
            await hub.setHeaters(device, { tool: 0, bed: 0, chamber: 0 });
            break;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
      return DONE_TEXT[actionKey];
    },
  },
};
