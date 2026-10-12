// -----------------------------------------------------------------------------
// Reading OctoPrint answers into one small "snapshot" shape, whether they come
// from the REST API (/api/printer + /api/job) or from the push link
// (`history` / `current` messages, which carry the same objects).
//
// Every shape below was recorded on OctoPrint 1.11.8 with its virtual printer
// (test/fixtures/octoprint/).
// -----------------------------------------------------------------------------

// Printer states, as the integration publishes them. The first two are the
// integration's own (OctoPrint itself does not answer, or refuses the key).
export const STATES = [
  'unreachable',
  'unauthorized',
  'offline',
  'connecting',
  'operational',
  'printing',
  'pausing',
  'paused',
  'resuming',
  'cancelling',
  'finishing',
  'error',
];

// A print job is running (possibly held).
export const ACTIVE_STATES = new Set([
  'printing',
  'pausing',
  'paused',
  'resuming',
  'cancelling',
  'finishing',
]);

const HEATERS = /^(tool\d+|bed|chamber)$/;

/**
 * The state of the printer, from `{ text, flags }` (REST and push alike), or
 * from the bare text of /api/job when /api/printer answers 409.
 * @param {{ text?: string, flags?: Record<string, boolean> } | null} state
 * @returns {string} one of STATES
 */
export function stateCode(state) {
  const text = typeof state?.text === 'string' ? state.text : '';
  const flags = state?.flags ?? {};
  if (flags.error || /error/i.test(text)) {
    return 'error';
  }
  if (flags.cancelling) {
    return 'cancelling';
  }
  if (flags.finishing) {
    return 'finishing';
  }
  if (flags.pausing) {
    return 'pausing';
  }
  if (flags.resuming) {
    return 'resuming';
  }
  if (flags.paused) {
    return 'paused';
  }
  if (flags.printing) {
    return 'printing';
  }
  if (flags.closedOrError) {
    return 'offline';
  }
  if (flags.operational || flags.ready) {
    return 'operational';
  }
  // No flags: the texts of OctoPrint's comm layer.
  if (/^(starting|printing|sending|transferring)/i.test(text)) {
    return 'printing';
  }
  if (/^(opening|connecting|detecting)/i.test(text)) {
    return 'connecting';
  }
  if (/^operational/i.test(text)) {
    return 'operational';
  }
  if (/^paused/i.test(text)) {
    return 'paused';
  }
  return 'offline';
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Heaters of a `temperature` object (REST) or of the last entry of `temps`
 * (push). A heater the printer lacks comes with null values: it is dropped.
 * @returns {Record<string, { actual: number | null, target: number | null }>}
 */
export function readTemperatures(source) {
  const temperatures = {};
  if (!source || typeof source !== 'object') {
    return temperatures;
  }
  for (const [heater, value] of Object.entries(source)) {
    if (!HEATERS.test(heater) || !value || typeof value !== 'object') {
      continue;
    }
    const actual = finite(value.actual);
    const target = finite(value.target);
    if (actual === null && target === null) {
      continue;
    }
    temperatures[heater] = { actual, target };
  }
  return temperatures;
}

function readJob(job, progress) {
  const file = job?.file ?? {};
  const name = [file.display, file.name, file.path].find(
    (value) => typeof value === 'string' && value !== '',
  );
  return {
    file: name ?? null,
    progress: finite(progress?.completion),
    printTime: finite(progress?.printTime),
    printTimeLeft: finite(progress?.printTimeLeft),
    estimatedPrintTime: finite(job?.estimatedPrintTime),
  };
}

/**
 * From the REST answers. `printer` is null when /api/printer answered 409
 * (printer not connected): the job state text then tells offline from
 * connecting.
 */
export function fromRest(printer, job) {
  const state = printer?.state ?? { text: typeof job?.state === 'string' ? job.state : '' };
  return {
    state: stateCode(state),
    error: [printer?.state?.error, job?.error].find((e) => typeof e === 'string' && e) ?? '',
    temperatures: readTemperatures(printer?.temperature),
    ...readJob(job?.job, job?.progress),
  };
}

/**
 * From a push `history` or `current` message. A message without temperatures
 * keeps the previous ones (`temperatures` is then undefined).
 */
export function fromPush(message) {
  const temps = Array.isArray(message?.temps) ? message.temps : [];
  const last = temps.at(-1);
  return {
    state: stateCode(message?.state),
    error: typeof message?.state?.error === 'string' ? message.state.error : '',
    temperatures: last ? readTemperatures(last) : undefined,
    ...readJob(message?.job, message?.progress),
  };
}

/**
 * What the printer has, from /api/printerprofiles (the current profile) and
 * /api/settings (name, webcam). Either may be missing (permissions).
 * @returns {{ name: string, model: string, tools: string[], bed: boolean, chamber: boolean, camera: boolean }}
 */
export function readCapabilities(profiles, settings) {
  const all = Object.values(profiles?.profiles ?? {});
  const profile = all.find((p) => p?.current) ?? all.find((p) => p?.default) ?? all[0] ?? {};
  const extruder = profile.extruder ?? {};
  const count = Number.isInteger(extruder.count) ? extruder.count : 1;
  // A shared nozzle has one heater, whatever the number of extruders.
  const heaters = extruder.sharedNozzle ? 1 : Math.min(Math.max(count, 1), 8);
  const webcams = Array.isArray(settings?.webcam?.webcams) ? settings.webcam.webcams : [];
  return {
    name: typeof settings?.appearance?.name === 'string' ? settings.appearance.name.trim() : '',
    model: typeof profile.model === 'string' ? profile.model : '',
    tools: Array.from({ length: heaters }, (_, index) => `tool${index}`),
    bed: profile.heatedBed !== false,
    chamber: profile.heatedChamber === true,
    camera: settings?.webcam?.webcamEnabled !== false && webcams.some((w) => w?.canSnapshot),
  };
}

/** Same device structure? (a change shows "Update" in the Discovery screen) */
export function sameStructure(a, b) {
  return (
    !!a &&
    !!b &&
    a.tools.join() === b.tools.join() &&
    a.bed === b.bed &&
    a.chamber === b.chamber &&
    a.camera === b.camera
  );
}
